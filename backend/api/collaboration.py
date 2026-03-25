"""
backend/api/collaboration.py
============================
Collaboration management and role-based access control.

Covers
------
  - Inviting collaborators (owner / maintainer)
  - Accepting or rejecting an invitation (invitee)
  - Listing collaborators (with optional status filter)
  - Changing a collaborator's role (owner only)
  - Removing a collaborator (owner or maintainer, with restrictions)
  - Transferring repository ownership (current owner only)
  - Querying the current user's role in a repository
  - Querying the current user's full access level (read / write / admin)

All write endpoints require a valid Bearer token.
py_git enforces its own permission rules at the DB layer; the route layer
also enforces them so we can return the correct HTTP status code.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Literal, Optional

from ..api.deps import get_current_user
from ..model.collaboration import (
    InviteCollaboratorRequest,
    RespondToInvitationRequest,
    ChangeRoleRequest,
    TransferOwnershipRequest,
)

# py_git is synchronous (psycopg2-based).
# FastAPI automatically runs plain `def` routes in a thread-pool, so no
# asyncio.run_in_executor boilerplate is needed here.
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from py_git import (
    PyGit,
    PyGitError,
    AccessDeniedError,
    DuplicateError,
    ValidationError,
    UserNotFoundError,
    RepoNotFoundError,
)

git = PyGit()  # one shared instance per worker process

router = APIRouter(
    prefix="/repos/{repo_id}/collaborators",
    tags=["Collaboration"],
)

repo_router = APIRouter(
    prefix="/repos/{repo_id}",
    tags=["Collaboration"],
)


# ── internal helper ──────────────────────────────────────────────────────────

def _handle_pygit_errors(exc: PyGitError) -> HTTPException:
    """Map py_git exceptions to the appropriate HTTP status codes."""
    if isinstance(exc, AccessDeniedError):
        return HTTPException(403, detail=str(exc))
    if isinstance(exc, DuplicateError):
        return HTTPException(409, detail=str(exc))
    if isinstance(exc, ValidationError):
        return HTTPException(422, detail=str(exc))
    if isinstance(exc, (UserNotFoundError, RepoNotFoundError)):
        return HTTPException(404, detail=str(exc))
    return HTTPException(400, detail=str(exc))


# ════════════════════════════════════════════════════════════════════════════
# INVITATIONS
# ════════════════════════════════════════════════════════════════════════════

@router.post(
    "/invite",
    summary="Invite a user to collaborate",
    description=(
        "Send a collaboration invitation. "
        "Caller must be the repository owner or a maintainer. "
        "The invitee must already have a HitGub account."
    ),
)
def invite_collaborator(
    repo_id: int,
    body: InviteCollaboratorRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Roles that can call this: owner, maintainer
    """
    try:
        result = git.invite_collaborator(
            repo_id=repo_id,
            invitee_id=body.invitee_id,
            role=body.role,
            invited_by=current_user["user_id"],
        )
        return result
    except PyGitError as exc:
        raise _handle_pygit_errors(exc)


@router.post(
    "/respond",
    summary="Accept or reject a collaboration invitation",
    description=(
        "The invitee calls this endpoint to accept (accept=true) "
        "or decline (accept=false) a pending invitation."
    ),
)
def respond_to_invitation(
    repo_id: int,
    body: RespondToInvitationRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Only the invitee (current_user) can respond to their own invitation.
    """
    try:
        result = git.respond_to_invitation(
            repo_id=repo_id,
            user_id=current_user["user_id"],
            accept=body.accept,
        )
        return {
            "status": "accepted" if body.accept else "rejected",
            "detail": result,
        }
    except PyGitError as exc:
        raise _handle_pygit_errors(exc)


# ════════════════════════════════════════════════════════════════════════════
# LIST COLLABORATORS
# ════════════════════════════════════════════════════════════════════════════

@router.get(
    "",
    summary="List collaborators for a repository",
    description=(
        "Returns collaborators filtered by status. "
        "Use status=accepted (default), status=pending, or omit for all records."
    ),
)
def list_collaborators(
    repo_id: int,
    status: Optional[Literal["accepted", "pending", "revoked"]] = Query(
        default="accepted",
        description="Filter by invitation status. Omit to return all records.",
    ),
    current_user: dict = Depends(get_current_user),
):
    """
    Any accepted collaborator (including read-only) can call this.
    Public repo collaborators are visible to everyone.
    """
    try:
        # pass None to get all statuses; otherwise pass the filter value
        records = git.list_collaborators(repo_id, status=status)
        return {"repo_id": repo_id, "collaborators": records}
    except PyGitError as exc:
        raise _handle_pygit_errors(exc)


# ════════════════════════════════════════════════════════════════════════════
# CHANGE ROLE
# ════════════════════════════════════════════════════════════════════════════

@router.patch(
    "/{user_id}",
    summary="Change a collaborator's role",
    description=(
        "Update the role of an existing collaborator. "
        "Only the repository owner can call this endpoint."
    ),
)
def change_collaborator_role(
    repo_id: int,
    user_id: int,
    body: ChangeRoleRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Roles that can call this: owner only

    Valid target roles: maintainer, contributor, read-only
    The owner's own role cannot be changed through this endpoint;
    use /transfer for ownership transfer.
    """
    if not git.can_admin(current_user["user_id"], repo_id):
        raise HTTPException(
            403,
            detail="Only the repository owner can change collaborator roles.",
        )

    current_role = git.get_user_role(current_user["user_id"], repo_id)
    if current_role != "owner":
        raise HTTPException(
            403,
            detail="Only the repository owner can change collaborator roles.",
        )

    try:
        result = git.update_collaborator_role(
            repo_id=repo_id,
            user_id=user_id,
            new_role=body.new_role,
            actor_id=current_user["user_id"],
        )
        return result
    except PyGitError as exc:
        raise _handle_pygit_errors(exc)


# ════════════════════════════════════════════════════════════════════════════
# REMOVE COLLABORATOR
# ════════════════════════════════════════════════════════════════════════════

@router.delete(
    "/{user_id}",
    summary="Remove a collaborator from the repository",
    description=(
        "Revokes access for a collaborator. The record is kept for audit purposes. "
        "Permission rules: owner can remove anyone except themselves; "
        "maintainer can remove contributors and read-only members only."
    ),
)
def remove_collaborator(
    repo_id: int,
    user_id: int,
    current_user: dict = Depends(get_current_user),
):
    """
    Roles that can call this: owner, maintainer (with restrictions above)
    """
    actor_id = current_user["user_id"]

    if not git.can_admin(actor_id, repo_id):
        raise HTTPException(
            403,
            detail="Only owners and maintainers can remove collaborators.",
        )

    try:
        git.remove_collaborator(
            repo_id=repo_id,
            user_id=user_id,
            actor_id=actor_id,
        )
        return {"detail": f"User {user_id} has been removed from repository {repo_id}."}
    except PyGitError as exc:
        raise _handle_pygit_errors(exc)


# ════════════════════════════════════════════════════════════════════════════
# TRANSFER OWNERSHIP
# ════════════════════════════════════════════════════════════════════════════

@repo_router.post(
    "/transfer",
    summary="Transfer repository ownership",
    description=(
        "Transfers ownership to another user who must already be an accepted collaborator. "
        "After transfer: new_owner_id becomes 'owner', the previous owner becomes 'maintainer'."
    ),
)
def transfer_ownership(
    repo_id: int,
    body: TransferOwnershipRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Roles that can call this: owner only
    """
    actor_id = current_user["user_id"]

    current_role = git.get_user_role(actor_id, repo_id)
    if current_role != "owner":
        raise HTTPException(
            403,
            detail="Only the current owner can transfer repository ownership.",
        )

    try:
        result = git.transfer_ownership(
            repo_id=repo_id,
            current_owner_id=actor_id,
            new_owner_id=body.new_owner_id,
        )
        return {
            "detail": "Ownership transferred successfully.",
            "new_owner_id": body.new_owner_id,
            "previous_owner_id": actor_id,
            "result": result,
        }
    except PyGitError as exc:
        raise _handle_pygit_errors(exc)


# ════════════════════════════════════════════════════════════════════════════
# ROLE AND ACCESS QUERIES
# ════════════════════════════════════════════════════════════════════════════

@repo_router.get(
    "/my-role",
    summary="Get the current user's role in a repository",
    description=(
        "Returns the caller's role. "
        "Possible values: owner, maintainer, contributor, read-only, none."
    ),
)
def get_my_role(
    repo_id: int,
    current_user: dict = Depends(get_current_user),
):
    try:
        role = git.get_user_role(
            user_id=current_user["user_id"],
            repo_id=repo_id,
        )
        return {
            "user_id": current_user["user_id"],
            "repo_id": repo_id,
            "role": role,
        }
    except PyGitError as exc:
        raise _handle_pygit_errors(exc)


@repo_router.get(
    "/access",
    summary="Get the current user's full access level",
    description=(
        "Returns a breakdown of read / write / admin permissions "
        "for the calling user on the specified repository."
    ),
)
def get_my_access(
    repo_id: int,
    current_user: dict = Depends(get_current_user),
):
    uid = current_user["user_id"]
    try:
        return {
            "user_id": uid,
            "repo_id": repo_id,
            "can_read": git.can_read(uid, repo_id),
            "can_write": git.can_write(uid, repo_id),
            "can_admin": git.can_admin(uid, repo_id),
        }
    except PyGitError as exc:
        raise _handle_pygit_errors(exc)
