import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from database.connection import get_db

from .deps import get_current_user
from ..model.repository import (
    CreateBranchRequest,
    CreateRepositoryRequest,
    UpdateBranchProtectionRequest,
    UpdateRepositoryRequest,
)

REPO_NAME_RE = re.compile(r"^[a-zA-Z0-9_-]+$")
BRANCH_NAME_RE = re.compile(r"^[a-zA-Z0-9/_-]+$")
RESTORE_WINDOW_DAYS = 30

router = APIRouter(prefix="/repos", tags=["Repository"])


def _to_repo_payload(row: Any) -> dict:
    return {
        "repository_id": row["repository_id"],
        "owner_id": row["owner_id"],
        "name": row["name"],
        "description": row["description"],
        "visibility": row["visibility"],
        "default_branch": row["default_branch"],
        "is_initialized": row["is_initialized"],
        "has_readme": row["has_readme"],
        "license_type": row["license_type"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "owner": {
            "user_id": row["owner_user_id"],
            "username": row["owner_username"],
            "full_name": row["owner_full_name"],
            "avatar_url": row["owner_avatar_url"],
        },
    }


def _to_branch_payload(row: Any) -> dict:
    return {
        "branch_id": row["branch_id"],
        "repository_id": row["repository_id"],
        "name": row["name"],
        "is_protected": row["is_protected"],
        "is_default": row["is_default"],
        "created_by": row["created_by"],
        "created_at": row["created_at"],
        "last_commit_hash": row["last_commit_hash"],
        "last_commit_at": row["last_commit_at"],
        "created_by_user": {
            "user_id": row["created_by_user_id"],
            "username": row["created_by_username"],
            "full_name": row["created_by_full_name"],
            "avatar_url": row["created_by_avatar_url"],
        },
    }


async def _ensure_soft_delete_columns(db) -> None:
    await db.execute("ALTER TABLE repositories ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP")
    await db.execute("ALTER TABLE repositories ADD COLUMN IF NOT EXISTS restore_deadline TIMESTAMP")


async def _get_repo_row(db, repo_id: int, include_deleted: bool = False):
    where_deleted = "" if include_deleted else "AND r.deleted_at IS NULL"
    return await db.fetchrow(
        f"""
        SELECT
            r.repository_id,
            r.owner_id,
            r.name,
            r.description,
            r.visibility,
            r.default_branch,
            r.is_initialized,
            r.has_readme,
            r.license_type,
            r.created_at,
            r.updated_at,
            r.deleted_at,
            r.restore_deadline,
            u.user_id AS owner_user_id,
            u.username AS owner_username,
            u.full_name AS owner_full_name,
            u.avatar_url AS owner_avatar_url
        FROM repositories r
        JOIN users u ON u.user_id = r.owner_id
        WHERE r.repository_id = $1 {where_deleted}
        """,
        repo_id,
    )


async def _get_role(db, user_id: int, repo_id: int) -> str:
    row = await db.fetchrow(
        """
        SELECT
            CASE
                WHEN r.owner_id = $1 THEN 'owner'
                ELSE COALESCE(rc.role, 'none')
            END AS role
        FROM repositories r
        LEFT JOIN repository_collaborators rc
            ON rc.repository_id = r.repository_id
           AND rc.user_id = $1
           AND rc.status = 'accepted'
        WHERE r.repository_id = $2
        """,
        user_id,
        repo_id,
    )
    if not row:
        return "none"
    return row["role"]


async def _ensure_read_access(db, user_id: int, repo_id: int) -> None:
    repo = await _get_repo_row(db, repo_id)
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    if repo["visibility"] == "public":
        return

    role = await _get_role(db, user_id, repo_id)
    if role == "none":
        raise HTTPException(status_code=403, detail="Access denied")


async def _ensure_owner(db, user_id: int, repo_id: int, include_deleted: bool = False):
    repo = await _get_repo_row(db, repo_id, include_deleted=include_deleted)
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    if repo["owner_id"] != user_id:
        raise HTTPException(status_code=403, detail="Only repository owner can perform this action")
    return repo


@router.get("")
async def list_repositories(
    scope: str = Query(default="member"),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    await _ensure_soft_delete_columns(db)

    if scope != "member":
        raise HTTPException(status_code=422, detail="Only scope=member is supported")

    rows = await db.fetch(
        """
        SELECT DISTINCT
            r.repository_id,
            r.owner_id,
            r.name,
            r.description,
            r.visibility,
            r.default_branch,
            r.is_initialized,
            r.has_readme,
            r.license_type,
            r.created_at,
            r.updated_at,
            u.user_id AS owner_user_id,
            u.username AS owner_username,
            u.full_name AS owner_full_name,
            u.avatar_url AS owner_avatar_url
        FROM repositories r
        JOIN users u ON u.user_id = r.owner_id
        LEFT JOIN repository_collaborators rc
            ON rc.repository_id = r.repository_id
           AND rc.user_id = $1
           AND rc.status = 'accepted'
        WHERE r.deleted_at IS NULL
          AND (r.owner_id = $1 OR rc.user_id IS NOT NULL)
        ORDER BY r.created_at DESC
        """,
        current_user["user_id"],
    )

    return [_to_repo_payload(r) for r in rows]


@router.get("/deleted")
async def list_deleted_repositories(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    await _ensure_soft_delete_columns(db)

    rows = await db.fetch(
        """
        SELECT
            r.repository_id,
            r.owner_id,
            r.name,
            r.deleted_at,
            r.restore_deadline,
            GREATEST(
                0,
                CEIL(EXTRACT(EPOCH FROM (r.restore_deadline - NOW())) / 86400)
            )::INT AS days_left
        FROM repositories r
        WHERE r.owner_id = $1
          AND r.deleted_at IS NOT NULL
        ORDER BY r.deleted_at DESC
        """,
        current_user["user_id"],
    )

    return [dict(r) for r in rows]


@router.get("/{repo_id}")
async def get_repository(
    repo_id: int,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    await _ensure_soft_delete_columns(db)
    await _ensure_read_access(db, current_user["user_id"], repo_id)
    row = await _get_repo_row(db, repo_id)
    if not row:
        raise HTTPException(status_code=404, detail="Repository not found")
    return _to_repo_payload(row)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_repository(
    body: CreateRepositoryRequest,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    await _ensure_soft_delete_columns(db)

    name = body.name.strip()
    default_branch = body.default_branch.strip()

    if not REPO_NAME_RE.match(name):
        raise HTTPException(
            status_code=422,
            detail="Repository name can contain only letters, numbers, underscore, and hyphen.",
        )
    if not BRANCH_NAME_RE.match(default_branch):
        raise HTTPException(
            status_code=422,
            detail="Branch name can contain only letters, numbers, slash, underscore, and hyphen.",
        )

    exists = await db.fetchrow(
        """
        SELECT repository_id
        FROM repositories
        WHERE owner_id = $1 AND LOWER(name) = LOWER($2) AND deleted_at IS NULL
        """,
        current_user["user_id"],
        name,
    )
    if exists:
        raise HTTPException(status_code=409, detail="Repository with this name already exists")

    async with db.transaction():
        repo = await db.fetchrow(
            """
            INSERT INTO repositories
                (owner_id, name, description, visibility, default_branch,
                 is_initialized, has_readme, license_type)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
            """,
            current_user["user_id"],
            name,
            body.description,
            body.visibility,
            default_branch,
            bool(body.initialize_with_readme),
            bool(body.initialize_with_readme),
            body.license_type,
        )

        await db.execute(
            """
            INSERT INTO branches (repository_id, name, is_protected, is_default, created_by)
            VALUES ($1, $2, FALSE, TRUE, $3)
            """,
            repo["repository_id"],
            default_branch,
            current_user["user_id"],
        )

        await db.execute(
            """
            INSERT INTO repository_collaborators
                (repository_id, user_id, role, invited_by, status, accepted_at)
            VALUES ($1, $2, 'owner', $2, 'accepted', NOW())
            """,
            repo["repository_id"],
            current_user["user_id"],
        )

    row = await _get_repo_row(db, repo["repository_id"])
    return _to_repo_payload(row)


@router.patch("/{repo_id}")
async def update_repository(
    repo_id: int,
    body: UpdateRepositoryRequest,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    await _ensure_soft_delete_columns(db)
    await _ensure_owner(db, current_user["user_id"], repo_id)

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=422, detail="No fields to update")

    if "name" in updates:
        updates["name"] = updates["name"].strip()
        if not REPO_NAME_RE.match(updates["name"]):
            raise HTTPException(status_code=422, detail="Invalid repository name")

    if "default_branch" in updates:
        updates["default_branch"] = updates["default_branch"].strip()
        if not BRANCH_NAME_RE.match(updates["default_branch"]):
            raise HTTPException(status_code=422, detail="Invalid branch name")
        branch = await db.fetchrow(
            "SELECT branch_id FROM branches WHERE repository_id = $1 AND name = $2",
            repo_id,
            updates["default_branch"],
        )
        if not branch:
            raise HTTPException(status_code=422, detail="Default branch must already exist")

    if "name" in updates:
        duplicate = await db.fetchrow(
            """
            SELECT repository_id
            FROM repositories
            WHERE owner_id = $1 AND LOWER(name) = LOWER($2)
              AND repository_id <> $3
              AND deleted_at IS NULL
            """,
            current_user["user_id"],
            updates["name"],
            repo_id,
        )
        if duplicate:
            raise HTTPException(status_code=409, detail="Repository name already exists")

    if updates.get("has_readme") is True:
        updates["is_initialized"] = True

    async with db.transaction():
        if "default_branch" in updates:
            await db.execute(
                "UPDATE branches SET is_default = FALSE WHERE repository_id = $1",
                repo_id,
            )
            await db.execute(
                "UPDATE branches SET is_default = TRUE WHERE repository_id = $1 AND name = $2",
                repo_id,
                updates["default_branch"],
            )

        allowed_columns = {
            "name",
            "description",
            "visibility",
            "default_branch",
            "has_readme",
            "license_type",
            "is_initialized",
        }
        final_updates = {k: v for k, v in updates.items() if k in allowed_columns}

        if final_updates:
            set_sql = ", ".join(f"{k} = ${idx}" for idx, k in enumerate(final_updates.keys(), start=1))
            values = list(final_updates.values()) + [repo_id]
            await db.execute(
                f"UPDATE repositories SET {set_sql}, updated_at = NOW() WHERE repository_id = ${len(values)}",
                *values,
            )

    row = await _get_repo_row(db, repo_id)
    return _to_repo_payload(row)


@router.delete("/{repo_id}")
async def move_repository_to_trash(
    repo_id: int,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    await _ensure_soft_delete_columns(db)
    repo = await _ensure_owner(db, current_user["user_id"], repo_id)

    if repo["deleted_at"] is not None:
        raise HTTPException(status_code=400, detail="Repository is already in trash")

    row = await db.fetchrow(
        """
        UPDATE repositories
        SET deleted_at = NOW(),
            restore_deadline = NOW() + INTERVAL '30 days',
            updated_at = NOW()
        WHERE repository_id = $1
        RETURNING repository_id, deleted_at, restore_deadline
        """,
        repo_id,
    )
    return dict(row)


@router.post("/{repo_id}/restore")
async def restore_repository(
    repo_id: int,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    await _ensure_soft_delete_columns(db)
    repo = await _ensure_owner(db, current_user["user_id"], repo_id, include_deleted=True)

    if repo["deleted_at"] is None:
        raise HTTPException(status_code=400, detail="Repository is not in trash")

    result = await db.execute(
        """
        UPDATE repositories
        SET deleted_at = NULL,
            restore_deadline = NULL,
            updated_at = NOW()
        WHERE repository_id = $1
          AND (restore_deadline IS NULL OR NOW() <= restore_deadline)
        """,
        repo_id,
    )

    if result == "UPDATE 0":
        raise HTTPException(status_code=400, detail="Restore window has expired")

    row = await _get_repo_row(db, repo_id)
    return _to_repo_payload(row)


@router.delete("/{repo_id}/permanent", status_code=status.HTTP_204_NO_CONTENT)
async def permanently_delete_repository(
    repo_id: int,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    await _ensure_soft_delete_columns(db)
    repo = await _ensure_owner(db, current_user["user_id"], repo_id, include_deleted=True)

    if repo["deleted_at"] is None:
        raise HTTPException(status_code=400, detail="Move repository to trash first")

    await db.execute("DELETE FROM repositories WHERE repository_id = $1", repo_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{repo_id}/members/me/role")
async def get_my_role(
    repo_id: int,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    await _ensure_soft_delete_columns(db)
    repo = await _get_repo_row(db, repo_id)
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    role = await _get_role(db, current_user["user_id"], repo_id)
    return {"role": role}


@router.get("/{repo_id}/stats")
async def get_repository_stats(
    repo_id: int,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    await _ensure_soft_delete_columns(db)
    await _ensure_read_access(db, current_user["user_id"], repo_id)

    row = await db.fetchrow(
        """
        SELECT
            r.repository_id,
            COUNT(DISTINCT b.branch_id)::INT AS branch_count,
            COUNT(DISTINCT CASE WHEN b.is_protected THEN b.branch_id END)::INT AS protected_branch_count,
            COUNT(DISTINCT CASE WHEN rc.status = 'accepted' THEN rc.user_id END)::INT AS collaborator_count,
            COUNT(DISTINCT CASE WHEN rc.status = 'pending' THEN rc.user_id END)::INT AS pending_invitation_count
        FROM repositories r
        LEFT JOIN branches b ON b.repository_id = r.repository_id
        LEFT JOIN repository_collaborators rc ON rc.repository_id = r.repository_id
        WHERE r.repository_id = $1 AND r.deleted_at IS NULL
        GROUP BY r.repository_id
        """,
        repo_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Repository not found")
    return dict(row)


@router.get("/{repo_id}/access-summary")
async def get_access_summary(
    repo_id: int,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    await _ensure_soft_delete_columns(db)
    await _ensure_read_access(db, current_user["user_id"], repo_id)

    by_role = await db.fetchrow(
        """
        SELECT
            COUNT(*) FILTER (WHERE role = 'owner' AND status = 'accepted')::INT AS owner,
            COUNT(*) FILTER (WHERE role = 'contributor' AND status = 'accepted')::INT AS contributor,
            COUNT(*) FILTER (WHERE role = 'read-only' AND status = 'accepted')::INT AS read_only
        FROM repository_collaborators
        WHERE repository_id = $1
        """,
        repo_id,
    )

    by_status = await db.fetchrow(
        """
        SELECT
            COUNT(*) FILTER (WHERE status = 'pending')::INT AS pending,
            COUNT(*) FILTER (WHERE status = 'accepted')::INT AS accepted,
            COUNT(*) FILTER (WHERE status = 'rejected')::INT AS rejected,
            COUNT(*) FILTER (WHERE status = 'revoked')::INT AS revoked
        FROM repository_collaborators
        WHERE repository_id = $1
        """,
        repo_id,
    )

    return {
        "repository_id": repo_id,
        "by_role": {
            "owner": by_role["owner"] if by_role else 0,
            "contributor": by_role["contributor"] if by_role else 0,
            "read-only": by_role["read_only"] if by_role else 0,
        },
        "by_status": {
            "pending": by_status["pending"] if by_status else 0,
            "accepted": by_status["accepted"] if by_status else 0,
            "rejected": by_status["rejected"] if by_status else 0,
            "revoked": by_status["revoked"] if by_status else 0,
        },
    }


@router.get("/{repo_id}/branches")
async def list_branches(
    repo_id: int,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    await _ensure_soft_delete_columns(db)
    await _ensure_read_access(db, current_user["user_id"], repo_id)

    rows = await db.fetch(
        """
        SELECT
            b.branch_id,
            b.repository_id,
            b.name,
            b.is_protected,
            b.is_default,
            b.created_by,
            b.created_at,
            b.last_commit_hash,
            b.last_commit_at,
            u.user_id AS created_by_user_id,
            u.username AS created_by_username,
            u.full_name AS created_by_full_name,
            u.avatar_url AS created_by_avatar_url
        FROM branches b
        LEFT JOIN users u ON u.user_id = b.created_by
        WHERE b.repository_id = $1
        ORDER BY b.is_default DESC, b.name ASC
        """,
        repo_id,
    )

    return [_to_branch_payload(r) for r in rows]


@router.post("/{repo_id}/branches", status_code=status.HTTP_201_CREATED)
async def create_branch(
    repo_id: int,
    body: CreateBranchRequest,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    await _ensure_soft_delete_columns(db)
    await _ensure_read_access(db, current_user["user_id"], repo_id)

    role = await _get_role(db, current_user["user_id"], repo_id)
    if role not in {"owner", "contributor", "maintainer"}:
        raise HTTPException(status_code=403, detail="Write access required")

    name = body.name.strip()
    if not BRANCH_NAME_RE.match(name):
        raise HTTPException(status_code=422, detail="Invalid branch name")

    duplicate = await db.fetchrow(
        "SELECT branch_id FROM branches WHERE repository_id = $1 AND LOWER(name) = LOWER($2)",
        repo_id,
        name,
    )
    if duplicate:
        raise HTTPException(status_code=409, detail="Branch with this name already exists")

    row = await db.fetchrow(
        """
        INSERT INTO branches
            (repository_id, name, is_protected, is_default, created_by)
        VALUES ($1, $2, FALSE, FALSE, $3)
        RETURNING
            branch_id,
            repository_id,
            name,
            is_protected,
            is_default,
            created_by,
            created_at,
            last_commit_hash,
            last_commit_at
        """,
        repo_id,
        name,
        current_user["user_id"],
    )

    user_row = await db.fetchrow(
        "SELECT user_id, username, full_name, avatar_url FROM users WHERE user_id = $1",
        row["created_by"],
    )

    payload = dict(row)
    payload.update(
        {
            "created_by_user_id": user_row["user_id"] if user_row else None,
            "created_by_username": user_row["username"] if user_row else None,
            "created_by_full_name": user_row["full_name"] if user_row else None,
            "created_by_avatar_url": user_row["avatar_url"] if user_row else None,
        }
    )
    return _to_branch_payload(payload)


@router.patch("/{repo_id}/branches/{branch_id}/protection")
async def update_branch_protection(
    repo_id: int,
    branch_id: int,
    body: UpdateBranchProtectionRequest,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    await _ensure_soft_delete_columns(db)
    await _ensure_owner(db, current_user["user_id"], repo_id)

    row = await db.fetchrow(
        """
        UPDATE branches
        SET is_protected = $1
        WHERE branch_id = $2 AND repository_id = $3
        RETURNING
            branch_id,
            repository_id,
            name,
            is_protected,
            is_default,
            created_by,
            created_at,
            last_commit_hash,
            last_commit_at
        """,
        body.is_protected,
        branch_id,
        repo_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Branch not found")

    user_row = await db.fetchrow(
        "SELECT user_id, username, full_name, avatar_url FROM users WHERE user_id = $1",
        row["created_by"],
    )
    payload = dict(row)
    payload.update(
        {
            "created_by_user_id": user_row["user_id"] if user_row else None,
            "created_by_username": user_row["username"] if user_row else None,
            "created_by_full_name": user_row["full_name"] if user_row else None,
            "created_by_avatar_url": user_row["avatar_url"] if user_row else None,
        }
    )
    return _to_branch_payload(payload)


@router.patch("/{repo_id}/branches/{branch_id}/default")
async def set_default_branch(
    repo_id: int,
    branch_id: int,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    await _ensure_soft_delete_columns(db)
    await _ensure_owner(db, current_user["user_id"], repo_id)

    target = await db.fetchrow(
        """
        SELECT branch_id, name, created_by
        FROM branches
        WHERE repository_id = $1 AND branch_id = $2
        """,
        repo_id,
        branch_id,
    )
    if not target:
        raise HTTPException(status_code=404, detail="Branch not found")

    async with db.transaction():
        await db.execute("UPDATE branches SET is_default = FALSE WHERE repository_id = $1", repo_id)
        await db.execute("UPDATE branches SET is_default = TRUE WHERE branch_id = $1", branch_id)
        await db.execute(
            "UPDATE repositories SET default_branch = $1, updated_at = NOW() WHERE repository_id = $2",
            target["name"],
            repo_id,
        )

    row = await db.fetchrow(
        """
        SELECT
            b.branch_id,
            b.repository_id,
            b.name,
            b.is_protected,
            b.is_default,
            b.created_by,
            b.created_at,
            b.last_commit_hash,
            b.last_commit_at,
            u.user_id AS created_by_user_id,
            u.username AS created_by_username,
            u.full_name AS created_by_full_name,
            u.avatar_url AS created_by_avatar_url
        FROM branches b
        LEFT JOIN users u ON u.user_id = b.created_by
        WHERE b.branch_id = $1
        """,
        branch_id,
    )
    return _to_branch_payload(row)


@router.delete("/{repo_id}/branches/{branch_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_branch(
    repo_id: int,
    branch_id: int,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    await _ensure_soft_delete_columns(db)
    await _ensure_owner(db, current_user["user_id"], repo_id)

    row = await db.fetchrow(
        "SELECT branch_id, is_default FROM branches WHERE repository_id = $1 AND branch_id = $2",
        repo_id,
        branch_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Branch not found")
    if row["is_default"]:
        raise HTTPException(status_code=400, detail="Cannot delete the default branch")

    await db.execute(
        "DELETE FROM branches WHERE repository_id = $1 AND branch_id = $2",
        repo_id,
        branch_id,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
