import io
import json
import re
import zipfile
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status

from database.connection import get_db

from .deps import get_current_user
from ..model.repository import (
    CreateBranchRequest,
    CreateFolderRequest,
    CreateRepositoryRequest,
    UpdateBranchProtectionRequest,
    UpdateRepositoryRequest,
)

REPO_NAME_RE = re.compile(r"^[a-zA-Z0-9_-]+$")
BRANCH_NAME_RE = re.compile(r"^[a-zA-Z0-9/_-]+$")
RESTORE_WINDOW_DAYS = 30
_SOFT_DELETE_SCHEMA_VERIFIED = False
_CODE_SCHEMA_VERIFIED = False

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
    global _SOFT_DELETE_SCHEMA_VERIFIED
    if _SOFT_DELETE_SCHEMA_VERIFIED:
        return

    rows = await db.fetch(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'repositories'
          AND column_name = ANY($1::text[])
        """,
        ["deleted_at", "restore_deadline"],
    )
    found = {row["column_name"] for row in rows}
    missing = [name for name in ["deleted_at", "restore_deadline"] if name not in found]
    if missing:
        raise HTTPException(
            status_code=500,
            detail=(
                "Database schema is missing soft-delete columns: "
                + ", ".join(missing)
                + ". Run migration/init.sql before starting the API."
            ),
        )

    _SOFT_DELETE_SCHEMA_VERIFIED = True


async def _ensure_code_tables(db) -> None:
    global _CODE_SCHEMA_VERIFIED
    if _CODE_SCHEMA_VERIFIED:
        return

    row = await db.fetchrow(
        """
        SELECT
            to_regclass('public.branch_commits') AS branch_commits,
            to_regclass('public.branch_files') AS branch_files,
            to_regclass('public.branch_directories') AS branch_directories
        """
    )
    missing = []
    if not row or row["branch_commits"] is None:
        missing.append("branch_commits")
    if not row or row["branch_files"] is None:
        missing.append("branch_files")
    if not row or row["branch_directories"] is None:
        missing.append("branch_directories")

    if missing:
        raise HTTPException(
            status_code=500,
            detail=(
                "Database schema is missing code tables: "
                + ", ".join(missing)
                + ". Run migration/init.sql before using file upload endpoints."
            ),
        )

    _CODE_SCHEMA_VERIFIED = True


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


async def _ensure_branch_in_repo(db, repo_id: int, branch_id: int) -> dict:
    row = await db.fetchrow(
        """
        SELECT branch_id, repository_id, name, is_default
        FROM branches
        WHERE repository_id = $1 AND branch_id = $2
        """,
        repo_id,
        branch_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Branch not found")
    return dict(row)


def _normalize_path_prefix(path_value: str | None) -> str:
    if not path_value:
        return ""

    normalized = path_value.replace("\\", "/").strip().strip("/")
    if not normalized:
        return ""

    parts = [p for p in normalized.split("/") if p]
    if any(part in {".", ".."} for part in parts):
        raise HTTPException(status_code=422, detail="Invalid path")

    return "/".join(parts)


def _normalize_file_path(path_value: str) -> str:
    normalized = _normalize_path_prefix(path_value)
    if not normalized:
        raise HTTPException(status_code=422, detail="File path is required")
    return normalized


def _sanitize_filename(filename: str) -> str:
    cleaned = (filename or "").replace("\\", "/").strip()
    cleaned = cleaned.split("/")[-1].strip()
    if not cleaned or cleaned in {".", ".."}:
        raise HTTPException(status_code=422, detail="Invalid file name")
    return cleaned


def _join_storage_path(directory: str, filename: str) -> str:
    return f"{directory}/{filename}" if directory else filename


def _directory_name(path_value: str) -> str:
    return path_value.rsplit("/", 1)[-1]


def _iter_directory_ancestors(path_value: str) -> list[str]:
    normalized = _normalize_path_prefix(path_value)
    if not normalized:
        return []
    parts = normalized.split("/")
    return ["/".join(parts[:idx + 1]) for idx in range(len(parts))]


async def _touch_directory_hierarchy(
    db,
    *,
    repository_id: int,
    branch_id: int,
    directory_path: str,
    actor_id: int,
    commit_id: int,
) -> None:
    for ancestor_path in _iter_directory_ancestors(directory_path):
        await db.execute(
            """
            INSERT INTO branch_directories (
                repository_id, branch_id, path, name,
                created_by, last_touched_by, commit_id, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $5, $6, NOW(), NOW())
            ON CONFLICT (branch_id, path)
            DO UPDATE SET
                last_touched_by = EXCLUDED.last_touched_by,
                commit_id = EXCLUDED.commit_id,
                updated_at = NOW()
            """,
            repository_id,
            branch_id,
            ancestor_path,
            _directory_name(ancestor_path),
            actor_id,
            commit_id,
        )


def _build_directory_entries(file_rows: list[Any], directory_rows: list[Any], current_path: str) -> list[dict]:
    dir_entries: dict[str, dict] = {}
    file_entries: list[dict] = []
    prefix = f"{current_path}/" if current_path else ""

    def touch_directory(path_value: str, *, updated_at=None, commit_message=None):
        existing = dir_entries.get(path_value)
        payload = {
            "type": "dir",
            "name": _directory_name(path_value),
            "path": path_value,
            "updated_at": updated_at,
            "commit_message": commit_message,
        }
        if existing is None:
            dir_entries[path_value] = payload
            return

        if updated_at and (
            existing.get("updated_at") is None or updated_at > existing.get("updated_at")
        ):
            dir_entries[path_value] = payload

    for row in directory_rows:
        full_path = row["path"]

        if current_path:
            if not full_path.startswith(prefix):
                continue
            rel_path = full_path[len(prefix):]
        else:
            rel_path = full_path

        if not rel_path:
            continue

        if "/" in rel_path:
            dirname = rel_path.split("/", 1)[0]
            dir_path = _join_storage_path(current_path, dirname)
            touch_directory(dir_path)
            continue

        touch_directory(
            full_path,
            updated_at=row.get("updated_at"),
            commit_message=row.get("commit_message"),
        )

    for row in file_rows:
        full_path = row["path"]

        if current_path:
            if not full_path.startswith(prefix):
                continue
            rel_path = full_path[len(prefix):]
        else:
            rel_path = full_path

        if not rel_path:
            continue

        if "/" in rel_path:
            dirname = rel_path.split("/", 1)[0]
            dir_path = _join_storage_path(current_path, dirname)
            touch_directory(dir_path)
            continue

        file_entries.append(
            {
                "type": "file",
                "file_id": row["file_id"],
                "name": row["filename"],
                "path": full_path,
                "mime_type": row["mime_type"],
                "size_bytes": row["size_bytes"],
                "updated_at": row["updated_at"],
                "uploaded_by": row["uploaded_by"],
                "commit_id": row["commit_id"],
                "commit_message": row.get("commit_message"),
            }
        )

    directories = sorted(dir_entries.values(), key=lambda item: item["name"].lower())
    files = sorted(file_entries, key=lambda item: item["name"].lower())
    return directories + files


@router.get("")
async def list_repositories(
    scope: str = Query(default="member"),
    q: str = Query(default=""),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    await _ensure_soft_delete_columns(db)

    if scope not in {"member", "owned", "discover"}:
        raise HTTPException(
            status_code=422,
            detail="scope must be one of: member, owned, discover",
        )

    search = q.strip()
    search_sql = ""
    params: list[Any] = [current_user["user_id"]]
    if search:
        search_sql = (
            " AND ("
            "r.name ILIKE $2 "
            "OR COALESCE(r.description, '') ILIKE $2 "
            "OR u.username ILIKE $2"
            ")"
        )
        params.append(f"%{search}%")

    if scope == "owned":
        scope_sql = "r.owner_id = $1"
    elif scope == "discover":
        scope_sql = "(r.visibility = 'public' OR r.owner_id = $1 OR rc.user_id IS NOT NULL)"
    else:
        scope_sql = "(r.owner_id = $1 OR rc.user_id IS NOT NULL)"

    rows = await db.fetch(
        f"""
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
                    AND {scope_sql}
                    {search_sql}
        ORDER BY r.created_at DESC
                """,
                *params,
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


@router.get("/{repo_id}/branches/{branch_id}/files")
async def list_branch_files(
    repo_id: int,
    branch_id: int,
    path: str = Query(default=""),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    await _ensure_soft_delete_columns(db)
    await _ensure_code_tables(db)
    await _ensure_read_access(db, current_user["user_id"], repo_id)
    branch = await _ensure_branch_in_repo(db, repo_id, branch_id)

    current_path = _normalize_path_prefix(path)

    file_rows = await db.fetch(
        """
        SELECT
            f.file_id,
            f.path,
            f.filename,
            f.mime_type,
            f.size_bytes,
            f.updated_at,
            f.uploaded_by,
            f.commit_id,
            bc.message AS commit_message
        FROM branch_files f
        LEFT JOIN branch_commits bc ON bc.commit_id = f.commit_id
        WHERE f.repository_id = $1 AND f.branch_id = $2
        ORDER BY path
        """,
        repo_id,
        branch_id,
    )

    directory_rows = await db.fetch(
        """
        SELECT
            d.path,
            d.name,
            d.updated_at,
            d.commit_id,
            bc.message AS commit_message
        FROM branch_directories d
        LEFT JOIN branch_commits bc ON bc.commit_id = d.commit_id
        WHERE d.repository_id = $1 AND d.branch_id = $2
        ORDER BY d.path
        """,
        repo_id,
        branch_id,
    )

    return {
        "repository_id": repo_id,
        "branch_id": branch_id,
        "branch_name": branch["name"],
        "path": current_path,
        "entries": _build_directory_entries(file_rows, directory_rows, current_path),
    }


@router.get("/{repo_id}/branches/{branch_id}/files/raw")
async def download_branch_file(
    repo_id: int,
    branch_id: int,
    path: str = Query(...),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    await _ensure_soft_delete_columns(db)
    await _ensure_code_tables(db)
    await _ensure_read_access(db, current_user["user_id"], repo_id)
    await _ensure_branch_in_repo(db, repo_id, branch_id)

    normalized_path = _normalize_file_path(path)
    row = await db.fetchrow(
        """
        SELECT filename, mime_type, content
        FROM branch_files
        WHERE repository_id = $1 AND branch_id = $2 AND path = $3
        """,
        repo_id,
        branch_id,
        normalized_path,
    )
    if not row:
        raise HTTPException(status_code=404, detail="File not found")

    filename = row["filename"].replace('"', "")
    return Response(
        content=bytes(row["content"]),
        media_type=row["mime_type"] or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{repo_id}/branches/{branch_id}/folders/raw")
async def download_branch_folder(
    repo_id: int,
    branch_id: int,
    path: str = Query(...),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    await _ensure_soft_delete_columns(db)
    await _ensure_code_tables(db)
    await _ensure_read_access(db, current_user["user_id"], repo_id)
    await _ensure_branch_in_repo(db, repo_id, branch_id)

    folder_path = _normalize_path_prefix(path)
    if not folder_path:
        raise HTTPException(status_code=422, detail="Folder path is required")

    prefix = f"{folder_path}/%"

    file_rows = await db.fetch(
        """
        SELECT path, filename, content
        FROM branch_files
        WHERE repository_id = $1
          AND branch_id = $2
          AND path LIKE $3
        ORDER BY path
        """,
        repo_id,
        branch_id,
        prefix,
    )

    directory_rows = await db.fetch(
        """
        SELECT path
        FROM branch_directories
        WHERE repository_id = $1
          AND branch_id = $2
          AND (path = $3 OR path LIKE $4)
        ORDER BY path
        """,
        repo_id,
        branch_id,
        folder_path,
        prefix,
    )

    if not file_rows and not directory_rows:
        raise HTTPException(status_code=404, detail="Folder not found")

    folder_name = _directory_name(folder_path)
    buffer = io.BytesIO()

    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        for directory in directory_rows:
            full_path = directory["path"]
            if full_path == folder_path:
                continue
            rel_path = full_path[len(folder_path):].lstrip("/")
            if not rel_path:
                continue
            archive.writestr(f"{rel_path.rstrip('/')}/", b"")

        for row in file_rows:
            full_path = row["path"]
            rel_path = full_path[len(folder_path):].lstrip("/")
            if not rel_path:
                continue
            archive.writestr(rel_path, bytes(row["content"]))

    buffer.seek(0)
    safe_name = folder_name.replace('"', "")
    return Response(
        content=buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.zip"'},
    )


@router.post("/{repo_id}/branches/{branch_id}/files/upload", status_code=status.HTTP_201_CREATED)
async def upload_branch_files(
    repo_id: int,
    branch_id: int,
    commit_message: str = Form(...),
    target_path: str = Form(default=""),
    relative_paths: str = Form(default=""),
    files: list[UploadFile] = File(...),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    await _ensure_soft_delete_columns(db)
    await _ensure_code_tables(db)
    await _ensure_read_access(db, current_user["user_id"], repo_id)
    branch = await _ensure_branch_in_repo(db, repo_id, branch_id)

    role = await _get_role(db, current_user["user_id"], repo_id)
    if role not in {"owner", "contributor", "maintainer"}:
        raise HTTPException(status_code=403, detail="Write access required")

    message = commit_message.strip()
    if not message:
        raise HTTPException(status_code=422, detail="Commit message is required")
    if not files:
        raise HTTPException(status_code=422, detail="At least one file is required")

    directory = _normalize_path_prefix(target_path)
    uploaded_relative_paths = [""] * len(files)

    if relative_paths.strip():
        try:
            parsed = json.loads(relative_paths)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=422, detail="Invalid relative_paths payload") from exc

        if not isinstance(parsed, list):
            raise HTTPException(status_code=422, detail="relative_paths must be an array")
        if len(parsed) != len(files):
            raise HTTPException(status_code=422, detail="relative_paths length must match files length")

        uploaded_relative_paths = ["" if item is None else str(item) for item in parsed]

    async with db.transaction():
        commit_row = await db.fetchrow(
            """
            INSERT INTO branch_commits (repository_id, branch_id, author_id, message)
            VALUES ($1, $2, $3, $4)
            RETURNING commit_id, created_at
            """,
            repo_id,
            branch_id,
            current_user["user_id"],
            message,
        )

        changed_files = []
        for idx, upload in enumerate(files):
            rel_path = (uploaded_relative_paths[idx] or "").strip()

            effective_directory = directory
            if rel_path:
                normalized_rel_path = _normalize_file_path(rel_path)
                if "/" in normalized_rel_path:
                    rel_dir, rel_name = normalized_rel_path.rsplit("/", 1)
                else:
                    rel_dir, rel_name = "", normalized_rel_path
                filename = _sanitize_filename(rel_name)
                effective_directory = _normalize_path_prefix(
                    _join_storage_path(directory, rel_dir)
                )
            else:
                filename = _sanitize_filename(upload.filename or "")

            full_path = _join_storage_path(effective_directory, filename)
            content = await upload.read()
            mime_type = upload.content_type or "application/octet-stream"

            if effective_directory:
                await _touch_directory_hierarchy(
                    db,
                    repository_id=repo_id,
                    branch_id=branch_id,
                    directory_path=effective_directory,
                    actor_id=current_user["user_id"],
                    commit_id=commit_row["commit_id"],
                )

            row = await db.fetchrow(
                """
                INSERT INTO branch_files (
                    repository_id, branch_id, path, filename, mime_type,
                    size_bytes, content, uploaded_by, commit_id, created_at, updated_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
                ON CONFLICT (branch_id, path)
                DO UPDATE SET
                    filename = EXCLUDED.filename,
                    mime_type = EXCLUDED.mime_type,
                    size_bytes = EXCLUDED.size_bytes,
                    content = EXCLUDED.content,
                    uploaded_by = EXCLUDED.uploaded_by,
                    commit_id = EXCLUDED.commit_id,
                    updated_at = NOW()
                RETURNING file_id, path, filename, mime_type, size_bytes, updated_at
                """,
                repo_id,
                branch_id,
                full_path,
                filename,
                mime_type,
                len(content),
                content,
                current_user["user_id"],
                commit_row["commit_id"],
            )
            changed_files.append(dict(row))

    return {
        "repository_id": repo_id,
        "branch_id": branch_id,
        "branch_name": branch["name"],
        "commit": {
            "commit_id": commit_row["commit_id"],
            "message": message,
            "author_id": current_user["user_id"],
            "created_at": commit_row["created_at"],
        },
        "changed_files": changed_files,
    }


@router.post("/{repo_id}/branches/{branch_id}/folders", status_code=status.HTTP_201_CREATED)
async def create_branch_folder(
    repo_id: int,
    branch_id: int,
    body: CreateFolderRequest,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    await _ensure_soft_delete_columns(db)
    await _ensure_code_tables(db)
    await _ensure_read_access(db, current_user["user_id"], repo_id)
    branch = await _ensure_branch_in_repo(db, repo_id, branch_id)

    role = await _get_role(db, current_user["user_id"], repo_id)
    if role not in {"owner", "contributor", "maintainer"}:
        raise HTTPException(status_code=403, detail="Write access required")

    folder_path = _normalize_path_prefix(body.folder_path)
    if not folder_path:
        raise HTTPException(status_code=422, detail="Folder path is required")

    message = body.commit_message.strip()
    if not message:
        raise HTTPException(status_code=422, detail="Commit message is required")

    async with db.transaction():
        commit_row = await db.fetchrow(
            """
            INSERT INTO branch_commits (repository_id, branch_id, author_id, message)
            VALUES ($1, $2, $3, $4)
            RETURNING commit_id, created_at
            """,
            repo_id,
            branch_id,
            current_user["user_id"],
            message,
        )

        await _touch_directory_hierarchy(
            db,
            repository_id=repo_id,
            branch_id=branch_id,
            directory_path=folder_path,
            actor_id=current_user["user_id"],
            commit_id=commit_row["commit_id"],
        )

        folder_row = await db.fetchrow(
            """
            SELECT path, name, updated_at, commit_id
            FROM branch_directories
            WHERE repository_id = $1 AND branch_id = $2 AND path = $3
            """,
            repo_id,
            branch_id,
            folder_path,
        )

    return {
        "repository_id": repo_id,
        "branch_id": branch_id,
        "branch_name": branch["name"],
        "directory": dict(folder_row) if folder_row else {"path": folder_path, "name": _directory_name(folder_path)},
        "commit": {
            "commit_id": commit_row["commit_id"],
            "message": message,
            "author_id": current_user["user_id"],
            "created_at": commit_row["created_at"],
        },
    }


@router.delete("/{repo_id}/branches/{branch_id}/files")
async def delete_branch_file(
    repo_id: int,
    branch_id: int,
    path: str = Query(...),
    commit_message: str = Query(default=""),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    await _ensure_soft_delete_columns(db)
    await _ensure_code_tables(db)
    await _ensure_read_access(db, current_user["user_id"], repo_id)
    await _ensure_branch_in_repo(db, repo_id, branch_id)

    role = await _get_role(db, current_user["user_id"], repo_id)
    if role not in {"owner", "contributor", "maintainer"}:
        raise HTTPException(status_code=403, detail="Write access required")

    normalized_path = _normalize_file_path(path)
    message = commit_message.strip() or f"Delete file {normalized_path}"

    async with db.transaction():
        commit_row = await db.fetchrow(
            """
            INSERT INTO branch_commits (repository_id, branch_id, author_id, message)
            VALUES ($1, $2, $3, $4)
            RETURNING commit_id, created_at
            """,
            repo_id,
            branch_id,
            current_user["user_id"],
            message,
        )

        deleted_row = await db.fetchrow(
            """
            DELETE FROM branch_files
            WHERE repository_id = $1 AND branch_id = $2 AND path = $3
            RETURNING file_id, path, filename
            """,
            repo_id,
            branch_id,
            normalized_path,
        )

    if not deleted_row:
        raise HTTPException(status_code=404, detail="File not found")

    return {
        "detail": "File deleted",
        "repository_id": repo_id,
        "branch_id": branch_id,
        "deleted_file": dict(deleted_row),
        "commit": {
            "commit_id": commit_row["commit_id"],
            "message": message,
            "author_id": current_user["user_id"],
            "created_at": commit_row["created_at"],
        },
    }


@router.delete("/{repo_id}/branches/{branch_id}/folders")
async def delete_branch_folder(
    repo_id: int,
    branch_id: int,
    path: str = Query(...),
    commit_message: str = Query(default=""),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    await _ensure_soft_delete_columns(db)
    await _ensure_code_tables(db)
    await _ensure_read_access(db, current_user["user_id"], repo_id)
    await _ensure_branch_in_repo(db, repo_id, branch_id)

    role = await _get_role(db, current_user["user_id"], repo_id)
    if role not in {"owner", "contributor", "maintainer"}:
        raise HTTPException(status_code=403, detail="Write access required")

    folder_path = _normalize_path_prefix(path)
    if not folder_path:
        raise HTTPException(status_code=422, detail="Folder path is required")

    prefix = f"{folder_path}/%"
    message = commit_message.strip() or f"Delete folder {folder_path}"

    async with db.transaction():
        commit_row = await db.fetchrow(
            """
            INSERT INTO branch_commits (repository_id, branch_id, author_id, message)
            VALUES ($1, $2, $3, $4)
            RETURNING commit_id, created_at
            """,
            repo_id,
            branch_id,
            current_user["user_id"],
            message,
        )

        deleted_files_result = await db.execute(
            """
            DELETE FROM branch_files
            WHERE repository_id = $1
              AND branch_id = $2
              AND (path = $3 OR path LIKE $4)
            """,
            repo_id,
            branch_id,
            folder_path,
            prefix,
        )

        deleted_dirs_result = await db.execute(
            """
            DELETE FROM branch_directories
            WHERE repository_id = $1
              AND branch_id = $2
              AND (path = $3 OR path LIKE $4)
            """,
            repo_id,
            branch_id,
            folder_path,
            prefix,
        )

    deleted_files = int(deleted_files_result.split(" ")[-1])
    deleted_folders = int(deleted_dirs_result.split(" ")[-1])

    if deleted_files == 0 and deleted_folders == 0:
        raise HTTPException(status_code=404, detail="Folder not found")

    return {
        "detail": "Folder deleted",
        "repository_id": repo_id,
        "branch_id": branch_id,
        "path": folder_path,
        "deleted_files": deleted_files,
        "deleted_folders": deleted_folders,
        "commit": {
            "commit_id": commit_row["commit_id"],
            "message": message,
            "author_id": current_user["user_id"],
            "created_at": commit_row["created_at"],
        },
    }
