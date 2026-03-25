from pydantic import BaseModel
from typing import Optional, Literal


# ── Request bodies ────────────────────────────────────────────────────────────

class InviteCollaboratorRequest(BaseModel):
    invitee_id: int
    role: Literal["maintainer", "contributor", "read-only"]


class RespondToInvitationRequest(BaseModel):
    accept: bool


class ChangeRoleRequest(BaseModel):
    new_role: Literal["maintainer", "contributor", "read-only"]


class TransferOwnershipRequest(BaseModel):
    new_owner_id: int


# ── Response schemas (for documentation; py_git returns plain dicts) ──────────

class CollaboratorOut(BaseModel):
    user_id: int
    username: str
    full_name: Optional[str] = None
    email: str
    avatar_url: Optional[str] = None
    role: str
    status: str
    invited_by_username: Optional[str] = None


class RoleOut(BaseModel):
    user_id: int
    repo_id: int
    role: str


class AccessOut(BaseModel):
    can_read: bool
    can_write: bool
    can_admin: bool
