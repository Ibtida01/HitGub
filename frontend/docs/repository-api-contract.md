# Repository Frontend API Contract

This document lists every backend address expected by the repository creation and management frontend.

## Base URL
- `VITE_API_URL` (default: `http://localhost:8000`)

## Auth
- Header: `Authorization: Bearer <token>` (optional in local mock mode)
- Content type: `application/json`

## Environment Toggle
- `VITE_REPO_USE_MOCK=true` (default) -> use in-memory dummy data
- `VITE_REPO_USE_MOCK=false` -> use backend APIs listed below

## 1) List Repositories
- Method: `GET`
- Address: `/repos?scope=member`
- Purpose: repos where current user is owner or accepted collaborator
- Response `200`:
```json
[
  {
    "repository_id": 1,
    "owner_id": 1,
    "name": "github-clone",
    "description": "Repository management and collaboration system",
    "visibility": "public",
    "default_branch": "main",
    "is_initialized": true,
    "has_readme": true,
    "license_type": "MIT",
    "created_at": "2025-06-01T00:00:00Z",
    "updated_at": "2025-06-01T00:00:00Z",
    "owner": {
      "user_id": 1,
      "username": "shakshor",
      "full_name": "Sadik Mahamud Shakshor",
      "avatar_url": null
    }
  }
]
```

## 2) Get Repository Detail
- Method: `GET`
- Address: `/repos/:repoId`
- Response `200`: same shape as one item from list

## 3) Create Repository
- Method: `POST`
- Address: `/repos`
- Request body:
```json
{
  "name": "demo-project",
  "description": "Optional text",
  "visibility": "public",
  "default_branch": "main",
  "license_type": "MIT",
  "initialize_with_readme": true
}
```
- Response `201`:
```json
{
  "repository_id": 10,
  "owner_id": 1,
  "name": "demo-project",
  "description": "Optional text",
  "visibility": "public",
  "default_branch": "main",
  "is_initialized": true,
  "has_readme": true,
  "license_type": "MIT",
  "created_at": "2026-03-25T10:00:00Z",
  "updated_at": "2026-03-25T10:00:00Z"
}
```

## 4) Update Repository Configuration
- Method: `PATCH`
- Address: `/repos/:repoId`
- Request body (partial allowed):
```json
{
  "name": "new-name",
  "description": "Updated description",
  "visibility": "private",
  "default_branch": "develop",
  "license_type": "Apache-2.0",
  "has_readme": true
}
```
- Response `200`: updated repository object

## 5) Move Repository To Trash (Soft Delete)
- Method: `DELETE`
- Address: `/repos/:repoId`
- Behavior: marks repository as deleted, starts a 30-day restore window
- Response `200` (or `204`):
```json
{
  "repository_id": 1,
  "deleted_at": "2026-03-25T10:00:00Z",
  "restore_deadline": "2026-04-24T10:00:00Z"
}
```

## 6) List Deleted Repositories (Trash)
- Method: `GET`
- Address: `/repos/deleted`
- Purpose: repositories deleted by current owner and still in trash
- Response `200`:
```json
[
  {
    "repository_id": 1,
    "owner_id": 1,
    "name": "github-clone",
    "deleted_at": "2026-03-25T10:00:00Z",
    "restore_deadline": "2026-04-24T10:00:00Z",
    "days_left": 30
  }
]
```

## 7) Restore Repository From Trash
- Method: `POST`
- Address: `/repos/:repoId/restore`
- Response `200`: restored repository object (same as active repository shape)

## 8) Permanently Delete Repository
- Method: `DELETE`
- Address: `/repos/:repoId/permanent`
- Behavior: irreversible delete from trash; removes branches/collaborator records
- Response `204`: empty body

## 9) Current User Role In Repository
- Method: `GET`
- Address: `/repos/:repoId/members/me/role`
- Response `200`:
```json
{ "role": "owner" }
```
- Possible values: `owner`, `contributor`, `read-only`, `none`

## 10) Repository Stats
- Method: `GET`
- Address: `/repos/:repoId/stats`
- Response `200`:
```json
{
  "repository_id": 1,
  "branch_count": 4,
  "protected_branch_count": 2,
  "collaborator_count": 5,
  "pending_invitation_count": 1
}
```

## 11) Access Summary
- Method: `GET`
- Address: `/repos/:repoId/access-summary`
- Response `200`:
```json
{
  "repository_id": 1,
  "by_role": {
    "owner": 1,
    "contributor": 3,
    "read-only": 1
  },
  "by_status": {
    "pending": 1,
    "accepted": 5,
    "rejected": 0,
    "revoked": 0
  }
}
```

## 12) List Branches
- Method: `GET`
- Address: `/repos/:repoId/branches`
- Response `200`:
```json
[
  {
    "branch_id": 11,
    "repository_id": 1,
    "name": "main",
    "is_protected": true,
    "is_default": true,
    "created_by": 1,
    "created_at": "2025-06-01T00:00:00Z",
    "last_commit_hash": "f6f7d8...",
    "last_commit_at": "2026-03-25T09:12:00Z",
    "created_by_user": {
      "user_id": 1,
      "username": "shakshor",
      "full_name": "Sadik Mahamud Shakshor",
      "avatar_url": null
    }
  }
]
```

## 13) Create Branch
- Method: `POST`
- Address: `/repos/:repoId/branches`
- Request body:
```json
{ "name": "feature/login-page" }
```
- Response `201`: created branch object

## 14) Update Branch Protection
- Method: `PATCH`
- Address: `/repos/:repoId/branches/:branchId/protection`
- Request body:
```json
{ "is_protected": true }
```
- Response `200`: updated branch object

## 15) Set Default Branch
- Method: `PATCH`
- Address: `/repos/:repoId/branches/:branchId/default`
- Request body: none
- Response `200`: updated branch object with `is_default=true`

## 16) Delete Branch
- Method: `DELETE`
- Address: `/repos/:repoId/branches/:branchId`
- Response `204`: empty body

## Validation Notes
- Repository name regex: `^[a-zA-Z0-9_-]+$`
- Branch name regex: `^[a-zA-Z0-9/_-]+$`
- Visibility enum: `public | private`
- License enum used by frontend: `MIT | Apache-2.0 | GPL-3.0 | BSD-3-Clause | null`
- Soft-delete fields used by frontend: `deleted_at`, `restore_deadline`, `days_left`

## Error Response Shape (recommended)
For `4xx/5xx`, frontend can handle plain text now, but this JSON shape is preferred:
```json
{
  "detail": "Human-readable error message"
}
```
