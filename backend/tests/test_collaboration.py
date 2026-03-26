"""
tests/test_collaboration.py
===========================
Comprehensive test suite for collaboration management and role-based access control.

Run from the project root:
    pytest tests/test_collaboration.py -v

Requirements (install before running):
    pip install pytest pytest-asyncio httpx fastapi

What is tested
--------------
  Section A  -  Auth dependency (deps.py)
  Section B  -  Invite collaborator
  Section C  -  Respond to invitation
  Section D  -  List collaborators
  Section E  -  Change collaborator role
  Section F  -  Remove collaborator
  Section G  -  Transfer ownership
  Section H  -  Get current user role
  Section I  -  Get current user access level
  Section J  -  Error handler mapping (_handle_pygit_errors)
  Section K  -  Model validation (Pydantic schemas)

Strategy
--------
  - py_git.PyGit is mocked at class level so no real database is needed.
  - The FastAPI dependency get_current_user is overridden via app.dependency_overrides.
  - httpx.AsyncClient is used with ASGITransport for full request/response testing.
  - Every endpoint is tested for: success path, all relevant error paths, and boundary cases.
"""

import pytest
import pytest_asyncio
from unittest.mock import MagicMock, patch, AsyncMock
from httpx import AsyncClient, ASGITransport


# ── Shared mock user fixtures ──────────────────────────────────────────────────

OWNER_USER      = {"user_id": 1, "username": "owner_user",  "email": "owner@test.com"}
MAINTAINER_USER = {"user_id": 2, "username": "maint_user",  "email": "maint@test.com"}
CONTRIBUTOR_USER= {"user_id": 3, "username": "contrib_user","email": "contrib@test.com"}
READONLY_USER   = {"user_id": 4, "username": "ro_user",     "email": "ro@test.com"}
STRANGER_USER   = {"user_id": 5, "username": "stranger",    "email": "stranger@test.com"}

REPO_ID = 10
COLLAB_USER_ID = 7


# ── App factory (avoids shared state between tests) ───────────────────────────

def make_app(current_user: dict, mock_git: MagicMock):
    """
    Build a fresh FastAPI app with:
      - get_current_user overridden to return `current_user`
      - PyGit patched to `mock_git`
    """
    with patch("backend.api.collaboration.git", mock_git):
        from fastapi import FastAPI
        from backend.api.collaboration import router, repo_router
        from backend.api.deps import get_current_user

        app = FastAPI()
        app.include_router(router)
        app.include_router(repo_router)

        async def fake_user():
            return current_user

        app.dependency_overrides[get_current_user] = fake_user
        return app


def fresh_git() -> MagicMock:
    """Return a MagicMock pre-configured with sensible defaults."""
    g = MagicMock()
    g.can_admin.return_value = True
    g.can_read.return_value  = True
    g.can_write.return_value = True
    g.get_user_role.return_value = "owner"
    return g


# ══════════════════════════════════════════════════════════════════════════════
# SECTION A — Auth dependency
# ══════════════════════════════════════════════════════════════════════════════

class TestAuthDependency:

    @pytest.mark.asyncio
    async def test_missing_authorization_header_returns_401(self):
        """Any protected endpoint returns 401 when Authorization header is absent."""
        from fastapi import FastAPI
        from backend.api.collaboration import router
        from backend.api.deps import get_current_user

        app = FastAPI()
        app.include_router(router)
        # Do NOT override dependency — let the real one run.
        # We still need to mock PyGit to avoid DB calls.
        with patch("backend.api.collaboration.git", fresh_git()):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                r = await client.get(f"/repos/{REPO_ID}/collaborators")
        assert r.status_code == 401

    @pytest.mark.asyncio
    async def test_malformed_authorization_header_returns_401(self):
        """Token not prefixed with 'Bearer ' is rejected."""
        from fastapi import FastAPI
        from backend.api.collaboration import router

        app = FastAPI()
        app.include_router(router)
        with patch("backend.api.collaboration.git", fresh_git()):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                r = await client.get(
                    f"/repos/{REPO_ID}/collaborators",
                    headers={"Authorization": "Token abc123"},
                )
        assert r.status_code == 401

    @pytest.mark.asyncio
    async def test_valid_token_resolves_user(self):
        """
        When the token exists in the DB, get_current_user returns user dict.
        Verified indirectly: the my-role endpoint succeeds with mocked user.
        """
        g = fresh_git()
        g.get_user_role.return_value = "contributor"
        app = make_app(CONTRIBUTOR_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.get(
                f"/repos/{REPO_ID}/my-role",
                headers={"Authorization": "Bearer valid-token"},
            )
        assert r.status_code == 200
        assert r.json()["role"] == "contributor"


# ══════════════════════════════════════════════════════════════════════════════
# SECTION B — Invite collaborator
# ══════════════════════════════════════════════════════════════════════════════

class TestInviteCollaborator:

    @pytest.mark.asyncio
    async def test_owner_can_invite(self):
        g = fresh_git()
        g.invite_collaborator.return_value = {
            "status": "pending", "repo_id": REPO_ID,
            "invitee_id": COLLAB_USER_ID, "role": "contributor",
        }
        app = make_app(OWNER_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                f"/repos/{REPO_ID}/collaborators/invite",
                json={"invitee_id": COLLAB_USER_ID, "role": "contributor"},
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 200
        assert r.json()["status"] == "pending"
        g.invite_collaborator.assert_called_once_with(
            repo_id=REPO_ID,
            invitee_id=COLLAB_USER_ID,
            role="contributor",
            invited_by=OWNER_USER["user_id"],
        )

    @pytest.mark.asyncio
    async def test_maintainer_can_invite(self):
        g = fresh_git()
        g.invite_collaborator.return_value = {"status": "pending"}
        app = make_app(MAINTAINER_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                f"/repos/{REPO_ID}/collaborators/invite",
                json={"invitee_id": COLLAB_USER_ID, "role": "read-only"},
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 200

    @pytest.mark.asyncio
    async def test_invite_invalid_role_returns_422(self):
        """'owner' is not a valid invite role — Pydantic rejects it before the route runs."""
        g = fresh_git()
        app = make_app(OWNER_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                f"/repos/{REPO_ID}/collaborators/invite",
                json={"invitee_id": COLLAB_USER_ID, "role": "owner"},
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 422
        g.invite_collaborator.assert_not_called()

    @pytest.mark.asyncio
    async def test_invite_duplicate_raises_409(self):
        from backend.api.collaboration import DuplicateError
        g = fresh_git()
        g.invite_collaborator.side_effect = DuplicateError("already invited")
        app = make_app(OWNER_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                f"/repos/{REPO_ID}/collaborators/invite",
                json={"invitee_id": COLLAB_USER_ID, "role": "contributor"},
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 409

    @pytest.mark.asyncio
    async def test_invite_access_denied_raises_403(self):
        from backend.api.collaboration import AccessDeniedError
        g = fresh_git()
        g.invite_collaborator.side_effect = AccessDeniedError("no permission")
        app = make_app(CONTRIBUTOR_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                f"/repos/{REPO_ID}/collaborators/invite",
                json={"invitee_id": COLLAB_USER_ID, "role": "contributor"},
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 403

    @pytest.mark.asyncio
    async def test_invite_user_not_found_raises_404(self):
        from backend.api.collaboration import UserNotFoundError
        g = fresh_git()
        g.invite_collaborator.side_effect = UserNotFoundError("user 99 not found")
        app = make_app(OWNER_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                f"/repos/{REPO_ID}/collaborators/invite",
                json={"invitee_id": 99, "role": "read-only"},
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 404

    @pytest.mark.asyncio
    async def test_invite_missing_body_returns_422(self):
        g = fresh_git()
        app = make_app(OWNER_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                f"/repos/{REPO_ID}/collaborators/invite",
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 422

    @pytest.mark.asyncio
    @pytest.mark.parametrize("role", ["maintainer", "contributor", "read-only"])
    async def test_all_valid_roles_accepted(self, role):
        g = fresh_git()
        g.invite_collaborator.return_value = {"status": "pending"}
        app = make_app(OWNER_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                f"/repos/{REPO_ID}/collaborators/invite",
                json={"invitee_id": COLLAB_USER_ID, "role": role},
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 200, f"Role '{role}' was rejected unexpectedly"


# ══════════════════════════════════════════════════════════════════════════════
# SECTION C — Respond to invitation
# ══════════════════════════════════════════════════════════════════════════════

class TestRespondToInvitation:

    @pytest.mark.asyncio
    async def test_accept_invitation(self):
        g = fresh_git()
        g.respond_to_invitation.return_value = {"status": "accepted"}
        app = make_app(CONTRIBUTOR_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                f"/repos/{REPO_ID}/collaborators/respond",
                json={"accept": True},
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 200
        assert r.json()["status"] == "accepted"
        g.respond_to_invitation.assert_called_once_with(
            repo_id=REPO_ID,
            user_id=CONTRIBUTOR_USER["user_id"],
            accept=True,
        )

    @pytest.mark.asyncio
    async def test_reject_invitation(self):
        g = fresh_git()
        g.respond_to_invitation.return_value = {"status": "rejected"}
        app = make_app(CONTRIBUTOR_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                f"/repos/{REPO_ID}/collaborators/respond",
                json={"accept": False},
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 200
        assert r.json()["status"] == "rejected"

    @pytest.mark.asyncio
    async def test_respond_no_pending_invite_raises_400(self):
        from backend.api.collaboration import PyGitError
        g = fresh_git()
        g.respond_to_invitation.side_effect = PyGitError("no pending invite found")
        app = make_app(CONTRIBUTOR_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                f"/repos/{REPO_ID}/collaborators/respond",
                json={"accept": True},
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 400

    @pytest.mark.asyncio
    async def test_respond_missing_body_returns_422(self):
        g = fresh_git()
        app = make_app(CONTRIBUTOR_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                f"/repos/{REPO_ID}/collaborators/respond",
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 422


# ══════════════════════════════════════════════════════════════════════════════
# SECTION D — List collaborators
# ══════════════════════════════════════════════════════════════════════════════

class TestListCollaborators:

    COLLAB_LIST = [
        {"user_id": 2, "username": "alice", "role": "maintainer", "status": "accepted"},
        {"user_id": 3, "username": "bob",   "role": "contributor","status": "accepted"},
    ]

    @pytest.mark.asyncio
    async def test_default_status_is_accepted(self):
        g = fresh_git()
        g.list_collaborators.return_value = self.COLLAB_LIST
        app = make_app(OWNER_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.get(
                f"/repos/{REPO_ID}/collaborators",
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 200
        g.list_collaborators.assert_called_once_with(REPO_ID, status="accepted")
        assert r.json()["repo_id"] == REPO_ID
        assert len(r.json()["collaborators"]) == 2

    @pytest.mark.asyncio
    async def test_filter_pending(self):
        g = fresh_git()
        g.list_collaborators.return_value = []
        app = make_app(OWNER_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.get(
                f"/repos/{REPO_ID}/collaborators?status=pending",
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 200
        g.list_collaborators.assert_called_once_with(REPO_ID, status="pending")

    @pytest.mark.asyncio
    async def test_filter_all_passes_none_to_pygit(self):
        """status=all must translate to status=None when calling py_git."""
        g = fresh_git()
        g.list_collaborators.return_value = self.COLLAB_LIST
        app = make_app(OWNER_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.get(
                f"/repos/{REPO_ID}/collaborators?status=all",
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 200
        g.list_collaborators.assert_called_once_with(REPO_ID, status=None)

    @pytest.mark.asyncio
    async def test_invalid_status_returns_422(self):
        g = fresh_git()
        app = make_app(OWNER_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.get(
                f"/repos/{REPO_ID}/collaborators?status=banana",
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 422
        g.list_collaborators.assert_not_called()

    @pytest.mark.asyncio
    async def test_repo_not_found_returns_404(self):
        from backend.api.collaboration import RepoNotFoundError
        g = fresh_git()
        g.list_collaborators.side_effect = RepoNotFoundError("repo not found")
        app = make_app(OWNER_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.get(
                f"/repos/9999/collaborators",
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 404


# ══════════════════════════════════════════════════════════════════════════════
# SECTION E — Change collaborator role
# ══════════════════════════════════════════════════════════════════════════════

class TestChangeCollaboratorRole:

    @pytest.mark.asyncio
    async def test_owner_can_change_role(self):
        g = fresh_git()
        g.get_user_role.return_value = "owner"
        g.update_collaborator_role.return_value = {
            "user_id": COLLAB_USER_ID, "role": "maintainer"
        }
        app = make_app(OWNER_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.patch(
                f"/repos/{REPO_ID}/collaborators/{COLLAB_USER_ID}",
                json={"new_role": "maintainer"},
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 200
        g.update_collaborator_role.assert_called_once_with(
            repo_id=REPO_ID,
            user_id=COLLAB_USER_ID,
            new_role="maintainer",
            actor_id=OWNER_USER["user_id"],
        )

    @pytest.mark.asyncio
    async def test_maintainer_cannot_change_role_gets_403(self):
        """
        Maintainer has admin access (can_admin=True) but get_user_role returns
        'maintainer', not 'owner', so the second guard blocks them.
        """
        g = fresh_git()
        g.get_user_role.return_value = "maintainer"
        app = make_app(MAINTAINER_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.patch(
                f"/repos/{REPO_ID}/collaborators/{COLLAB_USER_ID}",
                json={"new_role": "contributor"},
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 403
        g.update_collaborator_role.assert_not_called()

    @pytest.mark.asyncio
    async def test_contributor_cannot_change_role_gets_403(self):
        g = fresh_git()
        g.get_user_role.return_value = "contributor"
        app = make_app(CONTRIBUTOR_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.patch(
                f"/repos/{REPO_ID}/collaborators/{COLLAB_USER_ID}",
                json={"new_role": "read-only"},
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 403

    @pytest.mark.asyncio
    async def test_owner_role_is_not_an_assignable_role(self):
        """Trying to set role='owner' via this endpoint must be rejected by Pydantic."""
        g = fresh_git()
        g.get_user_role.return_value = "owner"
        app = make_app(OWNER_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.patch(
                f"/repos/{REPO_ID}/collaborators/{COLLAB_USER_ID}",
                json={"new_role": "owner"},
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 422
        g.update_collaborator_role.assert_not_called()

    @pytest.mark.asyncio
    @pytest.mark.parametrize("new_role", ["maintainer", "contributor", "read-only"])
    async def test_all_valid_target_roles_accepted(self, new_role):
        g = fresh_git()
        g.get_user_role.return_value = "owner"
        g.update_collaborator_role.return_value = {"user_id": COLLAB_USER_ID, "role": new_role}
        app = make_app(OWNER_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.patch(
                f"/repos/{REPO_ID}/collaborators/{COLLAB_USER_ID}",
                json={"new_role": new_role},
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 200, f"new_role='{new_role}' was unexpectedly rejected"


# ══════════════════════════════════════════════════════════════════════════════
# SECTION F — Remove collaborator
# ══════════════════════════════════════════════════════════════════════════════

class TestRemoveCollaborator:

    @pytest.mark.asyncio
    async def test_owner_can_remove_collaborator(self):
        g = fresh_git()
        g.remove_collaborator.return_value = True
        app = make_app(OWNER_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.delete(
                f"/repos/{REPO_ID}/collaborators/{COLLAB_USER_ID}",
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 200
        assert str(COLLAB_USER_ID) in r.json()["detail"]
        g.remove_collaborator.assert_called_once_with(
            repo_id=REPO_ID,
            user_id=COLLAB_USER_ID,
            actor_id=OWNER_USER["user_id"],
        )

    @pytest.mark.asyncio
    async def test_owner_cannot_remove_themselves(self):
        """Self-removal guard: user_id == actor_id must return 400 before hitting py_git."""
        g = fresh_git()
        app = make_app(OWNER_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.delete(
                f"/repos/{REPO_ID}/collaborators/{OWNER_USER['user_id']}",
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 400
        assert "cannot remove yourself" in r.json()["detail"].lower()
        g.remove_collaborator.assert_not_called()

    @pytest.mark.asyncio
    async def test_contributor_cannot_remove_gets_403(self):
        g = fresh_git()
        g.can_admin.return_value = False
        app = make_app(CONTRIBUTOR_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.delete(
                f"/repos/{REPO_ID}/collaborators/{COLLAB_USER_ID}",
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 403
        g.remove_collaborator.assert_not_called()

    @pytest.mark.asyncio
    async def test_remove_nonexistent_user_raises_404(self):
        from backend.api.collaboration import UserNotFoundError
        g = fresh_git()
        g.remove_collaborator.side_effect = UserNotFoundError("user not in repo")
        app = make_app(OWNER_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.delete(
                f"/repos/{REPO_ID}/collaborators/9999",
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 404

    @pytest.mark.asyncio
    async def test_maintainer_removing_another_maintainer_triggers_pygit_403(self):
        """
        A maintainer calling remove on another maintainer: route guard passes (can_admin=True),
        but py_git raises AccessDeniedError — correctly mapped to HTTP 403.
        """
        from backend.api.collaboration import AccessDeniedError
        g = fresh_git()
        g.remove_collaborator.side_effect = AccessDeniedError("maintainers cannot remove maintainers")
        app = make_app(MAINTAINER_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.delete(
                f"/repos/{REPO_ID}/collaborators/99",
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 403


# ══════════════════════════════════════════════════════════════════════════════
# SECTION G — Transfer ownership
# ══════════════════════════════════════════════════════════════════════════════

class TestTransferOwnership:

    @pytest.mark.asyncio
    async def test_owner_can_transfer(self):
        g = fresh_git()
        g.get_user_role.return_value = "owner"
        g.transfer_ownership.return_value = {"new_owner": COLLAB_USER_ID}
        app = make_app(OWNER_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                f"/repos/{REPO_ID}/transfer",
                json={"new_owner_id": COLLAB_USER_ID},
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 200
        body = r.json()
        assert body["new_owner_id"] == COLLAB_USER_ID
        assert body["previous_owner_id"] == OWNER_USER["user_id"]
        g.transfer_ownership.assert_called_once_with(
            repo_id=REPO_ID,
            current_owner_id=OWNER_USER["user_id"],
            new_owner_id=COLLAB_USER_ID,
        )

    @pytest.mark.asyncio
    async def test_non_owner_cannot_transfer_gets_403(self):
        g = fresh_git()
        g.get_user_role.return_value = "maintainer"
        app = make_app(MAINTAINER_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                f"/repos/{REPO_ID}/transfer",
                json={"new_owner_id": COLLAB_USER_ID},
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 403
        g.transfer_ownership.assert_not_called()

    @pytest.mark.asyncio
    async def test_transfer_to_self_returns_400(self):
        """Self-transfer guard: new_owner_id == actor_id must return 400 before any DB call."""
        g = fresh_git()
        app = make_app(OWNER_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                f"/repos/{REPO_ID}/transfer",
                json={"new_owner_id": OWNER_USER["user_id"]},
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 400
        assert "already the owner" in r.json()["detail"].lower()
        g.transfer_ownership.assert_not_called()

    @pytest.mark.asyncio
    async def test_transfer_to_non_collaborator_raises_400(self):
        from backend.api.collaboration import PyGitError
        g = fresh_git()
        g.get_user_role.return_value = "owner"
        g.transfer_ownership.side_effect = PyGitError("user is not an accepted collaborator")
        app = make_app(OWNER_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                f"/repos/{REPO_ID}/transfer",
                json={"new_owner_id": STRANGER_USER["user_id"]},
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 400

    @pytest.mark.asyncio
    async def test_transfer_missing_body_returns_422(self):
        g = fresh_git()
        app = make_app(OWNER_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                f"/repos/{REPO_ID}/transfer",
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 422


# ══════════════════════════════════════════════════════════════════════════════
# SECTION H — Get current user's role
# ══════════════════════════════════════════════════════════════════════════════

class TestGetMyRole:

    @pytest.mark.asyncio
    @pytest.mark.parametrize("role", ["owner", "maintainer", "contributor", "read-only", "none"])
    async def test_all_role_values_returned_correctly(self, role):
        g = fresh_git()
        g.get_user_role.return_value = role
        app = make_app(OWNER_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.get(
                f"/repos/{REPO_ID}/my-role",
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 200
        body = r.json()
        assert body["role"] == role
        assert body["user_id"] == OWNER_USER["user_id"]
        assert body["repo_id"] == REPO_ID

    @pytest.mark.asyncio
    async def test_repo_not_found_returns_404(self):
        from backend.api.collaboration import RepoNotFoundError
        g = fresh_git()
        g.get_user_role.side_effect = RepoNotFoundError("repo not found")
        app = make_app(OWNER_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.get(
                f"/repos/9999/my-role",
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 404


# ══════════════════════════════════════════════════════════════════════════════
# SECTION I — Get current user's access level
# ══════════════════════════════════════════════════════════════════════════════

class TestGetMyAccess:

    @pytest.mark.asyncio
    @pytest.mark.parametrize("can_read,can_write,can_admin", [
        (True,  True,  True),   # owner
        (True,  True,  False),  # contributor
        (True,  False, False),  # read-only
        (False, False, False),  # no access
    ])
    async def test_permission_combinations(self, can_read, can_write, can_admin):
        g = fresh_git()
        g.can_read.return_value  = can_read
        g.can_write.return_value = can_write
        g.can_admin.return_value = can_admin
        app = make_app(OWNER_USER, g)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.get(
                f"/repos/{REPO_ID}/access",
                headers={"Authorization": "Bearer tok"},
            )
        assert r.status_code == 200
        body = r.json()
        assert body["can_read"]  == can_read
        assert body["can_write"] == can_write
        assert body["can_admin"] == can_admin
        assert body["user_id"]   == OWNER_USER["user_id"]
        assert body["repo_id"]   == REPO_ID


# ══════════════════════════════════════════════════════════════════════════════
# SECTION J — Error handler mapping
# ══════════════════════════════════════════════════════════════════════════════

class TestErrorHandlerMapping:

    def _get_handler(self):
        from backend.api.collaboration import _handle_pygit_errors
        return _handle_pygit_errors

    def test_access_denied_maps_to_403(self):
        from backend.api.collaboration import AccessDeniedError
        h = self._get_handler()
        exc = h(AccessDeniedError("no"))
        assert exc.status_code == 403

    def test_duplicate_maps_to_409(self):
        from backend.api.collaboration import DuplicateError
        h = self._get_handler()
        exc = h(DuplicateError("dup"))
        assert exc.status_code == 409

    def test_validation_maps_to_422(self):
        from backend.api.collaboration import ValidationError
        h = self._get_handler()
        exc = h(ValidationError("bad value"))
        assert exc.status_code == 422

    def test_user_not_found_maps_to_404(self):
        from backend.api.collaboration import UserNotFoundError
        h = self._get_handler()
        exc = h(UserNotFoundError("no user"))
        assert exc.status_code == 404

    def test_repo_not_found_maps_to_404(self):
        from backend.api.collaboration import RepoNotFoundError
        h = self._get_handler()
        exc = h(RepoNotFoundError("no repo"))
        assert exc.status_code == 404

    def test_base_pygit_error_maps_to_400(self):
        from backend.api.collaboration import PyGitError
        h = self._get_handler()
        exc = h(PyGitError("generic error"))
        assert exc.status_code == 400

    def test_error_message_is_preserved_in_detail(self):
        from backend.api.collaboration import AccessDeniedError
        h = self._get_handler()
        exc = h(AccessDeniedError("specific message about denied access"))
        assert "specific message" in exc.detail


# ══════════════════════════════════════════════════════════════════════════════
# SECTION K — Pydantic model validation
# ══════════════════════════════════════════════════════════════════════════════

class TestModelValidation:

    def test_invite_request_valid(self):
        from backend.model.collaboration import InviteCollaboratorRequest
        m = InviteCollaboratorRequest(invitee_id=5, role="contributor")
        assert m.invitee_id == 5
        assert m.role == "contributor"

    def test_invite_request_rejects_owner_role(self):
        from backend.model.collaboration import InviteCollaboratorRequest
        from pydantic import ValidationError as PydanticValidationError
        with pytest.raises(PydanticValidationError):
            InviteCollaboratorRequest(invitee_id=5, role="owner")

    def test_invite_request_rejects_unknown_role(self):
        from backend.model.collaboration import InviteCollaboratorRequest
        from pydantic import ValidationError as PydanticValidationError
        with pytest.raises(PydanticValidationError):
            InviteCollaboratorRequest(invitee_id=5, role="superuser")

    def test_invite_request_requires_invitee_id(self):
        from backend.model.collaboration import InviteCollaboratorRequest
        from pydantic import ValidationError as PydanticValidationError
        with pytest.raises(PydanticValidationError):
            InviteCollaboratorRequest(role="contributor")

    def test_respond_request_valid_accept(self):
        from backend.model.collaboration import RespondToInvitationRequest
        m = RespondToInvitationRequest(accept=True)
        assert m.accept is True

    def test_respond_request_valid_reject(self):
        from backend.model.collaboration import RespondToInvitationRequest
        m = RespondToInvitationRequest(accept=False)
        assert m.accept is False

    def test_change_role_request_valid(self):
        from backend.model.collaboration import ChangeRoleRequest
        for role in ["maintainer", "contributor", "read-only"]:
            m = ChangeRoleRequest(new_role=role)
            assert m.new_role == role

    def test_change_role_rejects_owner(self):
        from backend.model.collaboration import ChangeRoleRequest
        from pydantic import ValidationError as PydanticValidationError
        with pytest.raises(PydanticValidationError):
            ChangeRoleRequest(new_role="owner")

    def test_transfer_request_valid(self):
        from backend.model.collaboration import TransferOwnershipRequest
        m = TransferOwnershipRequest(new_owner_id=42)
        assert m.new_owner_id == 42

    def test_transfer_request_requires_new_owner_id(self):
        from backend.model.collaboration import TransferOwnershipRequest
        from pydantic import ValidationError as PydanticValidationError
        with pytest.raises(PydanticValidationError):
            TransferOwnershipRequest()
