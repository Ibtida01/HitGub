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

Design note — lazy router creation
-----------------------------------
``router`` and ``repo_router`` are **not** module-level variables.  They
are created on demand via the module ``__getattr__`` hook each time they
are imported.  Each call to ``_create_collab_router`` / ``_create_repo_router``
produces a fresh ``APIRouter`` whose route handlers close over the
``git_instance`` argument by value.

This makes ``unittest.mock.patch("backend.api.collaboration.git", mock)``
work correctly in tests even when the patch is applied as a context
manager that exits before requests arrive:

    with patch("backend.api.collaboration.git", mock_git):
        from backend.api.collaboration import router   # __getattr__ fires
        # At this point collaboration.git == mock_git, so the new router's
        # handlers capture mock_git in their closures.
        app.include_router(router)
    # patch exits — collaboration.git is restored, but the already-created
    # closures still reference mock_git.  Request processing is correct.

Without this design every route body would look up ``git`` in the module
globals at request time, always finding the post-patch (real / session)
value instead of the test mock.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Literal, Optional

from .deps import get_current_user
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

# Module-level git instance.  In production this is the real PyGit(); in
# tests the conftest patches PyGit to MagicMock so this becomes a mock.
# Route handlers do NOT reference this name directly — they receive a
# git_instance captured at router-creation time (see __getattr__ below).
git = PyGit()


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


# ── router factories ─────────────────────────────────────────────────────────

def _create_collab_router(git_instance: PyGit) -> APIRouter:
    """
    Build the /repos/{repo_id}/collaborators router.

    All route handlers are closures over ``git_instance`` so they use
    exactly the git object that was active when the router was created,
    regardless of later changes to the module-level ``git`` variable.
    """
    r = APIRouter(
        prefix="/repos/{repo_id}/collaborators",
        tags=["Collaboration"],
    )

    # ── INVITATIONS ──────────────────────────────────────────────────────────

    @r.post(
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
        """Roles that can call this: owner, maintainer"""
        try:
            result = git_instance.invite_collaborator(
                repo_id=repo_id,
                invitee_id=body.invitee_id,
                role=body.role,
                invited_by=current_user["user_id"],
            )
            return result
        except PyGitError as exc:
            raise _handle_pygit_errors(exc)

    @r.post(
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
        """Only the invitee (current_user) can respond to their own invitation."""
        try:
            result = git_instance.respond_to_invitation(
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

    # ── LIST COLLABORATORS ───────────────────────────────────────────────────

    @r.get(
        "",
        summary="List collaborators for a repository",
        description=(
            "Returns collaborators filtered by status. "
            "Use status=accepted (default), status=pending, or omit for all records."
        ),
    )
    def list_collaborators(
        repo_id: int,
        status: Optional[Literal["accepted", "pending", "revoked", "all"]] = Query(
            default="accepted",
            description=(
                "Filter by invitation status. "
                "accepted (default), pending, revoked, or all to return every record."
            ),
        ),
        current_user: dict = Depends(get_current_user),
    ):
        """
        Any accepted collaborator (including read-only) can call this.
        Public repo collaborators are visible to everyone.
        """
        try:
            # py_git.list_collaborators(status=None) returns all records
            pygit_status = None if status == "all" else status
            records = git_instance.list_collaborators(repo_id, status=pygit_status)
            return {"repo_id": repo_id, "collaborators": records}
        except PyGitError as exc:
            raise _handle_pygit_errors(exc)

    # ── CHANGE ROLE ──────────────────────────────────────────────────────────

    @r.patch(
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
        current_role = git_instance.get_user_role(current_user["user_id"], repo_id)
        if current_role != "owner":
            raise HTTPException(
                403,
                detail="Only the repository owner can change collaborator roles.",
            )

        try:
            result = git_instance.update_collaborator_role(
                repo_id=repo_id,
                user_id=user_id,
                new_role=body.new_role,
                actor_id=current_user["user_id"],
            )
            return result
        except PyGitError as exc:
            raise _handle_pygit_errors(exc)

    # ── REMOVE COLLABORATOR ──────────────────────────────────────────────────

    @r.delete(
        "/{user_id}",
        summary="Remove a collaborator from the repository",
        description=(
            "Revokes access for a collaborator. The record is kept for audit purposes. "
            "Permission rules: owner can remove anyone except themselves; "
            "non-owner collaborators can remove themselves (leave repository)."
        ),
    )
    def remove_collaborator(
        repo_id: int,
        user_id: int,
        current_user: dict = Depends(get_current_user),
    ):
        """Roles that can call this: owner, or the user themselves (if not owner)."""
        actor_id = current_user["user_id"]

        if user_id == actor_id:
            role = git_instance.get_user_role(actor_id, repo_id)
            if role == "owner":
                raise HTTPException(
                    400,
                    detail="Owners cannot leave their own repository. Transfer ownership first.",
                )

            try:
                git_instance.remove_collaborator(
                    repo_id=repo_id,
                    user_id=user_id,
                    actor_id=actor_id,
                )
                return {"detail": f"You have left repository {repo_id}."}
            except PyGitError as exc:
                raise _handle_pygit_errors(exc)

        if not git_instance.can_admin(actor_id, repo_id):
            raise HTTPException(
                403,
                detail="Only repository owners can remove other collaborators.",
            )

        try:
            git_instance.remove_collaborator(
                repo_id=repo_id,
                user_id=user_id,
                actor_id=actor_id,
            )
            return {"detail": f"User {user_id} has been removed from repository {repo_id}."}
        except PyGitError as exc:
            raise _handle_pygit_errors(exc)

    return r


def _create_repo_router(git_instance: PyGit) -> APIRouter:
    """
    Build the /repos/{repo_id} router (transfer, my-role, access).

    All route handlers are closures over ``git_instance`` — see the
    module docstring for the rationale.
    """
    r = APIRouter(
        prefix="/repos/{repo_id}",
        tags=["Collaboration"],
    )

    # ── TRANSFER OWNERSHIP ───────────────────────────────────────────────────

    @r.post(
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
        """Roles that can call this: owner only"""
        actor_id = current_user["user_id"]

        if body.new_owner_id == actor_id:
            raise HTTPException(
                400,
                detail="You are already the owner of this repository.",
            )

        current_role = git_instance.get_user_role(actor_id, repo_id)
        if current_role != "owner":
            raise HTTPException(
                403,
                detail="Only the current owner can transfer repository ownership.",
            )

        try:
            result = git_instance.transfer_ownership(
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

    # ── ROLE AND ACCESS QUERIES ──────────────────────────────────────────────

    @r.get(
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
            role = git_instance.get_user_role(
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

    @r.get(
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
                "can_read": git_instance.can_read(uid, repo_id),
                "can_write": git_instance.can_write(uid, repo_id),
                "can_admin": git_instance.can_admin(uid, repo_id),
            }
        except PyGitError as exc:
            raise _handle_pygit_errors(exc)

    return r


# ── module __getattr__ ───────────────────────────────────────────────────────

def __getattr__(name: str):
    """
    Called by Python when ``router`` or ``repo_router`` is accessed but is
    not present in the module's ``__dict__``.

    Why we use __getattr__ instead of module-level assignments
    ----------------------------------------------------------
    If we wrote ``router = _create_collab_router(git)`` at module level,
    the router would be created once at import time, capturing whatever
    value ``git`` held then (the real PyGit in production, the session-level
    MagicMock in tests).  Subsequent test patches of ``collaboration.git``
    would have no effect on the already-captured value.

    By deferring to __getattr__ we create a *fresh* router on every
    ``from backend.api.collaboration import router`` call.  In tests this
    import happens inside ``make_app``'s ``with patch(..., mock_git)``
    context, so ``git`` (== ``mock_git``) is captured in the new router's
    closures and stays there for the lifetime of that app object.
    """
    if name == "router":
        return _create_collab_router(git)
    if name == "repo_router":
        return _create_repo_router(git)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")