# HitGub - Collaboration & Role-Based Access Control
## UI Developer Documentation
### Branch: ibtida01 | Prepared by: Backend (ibtida01)

---

## Table of Contents

1. Overview
2. Authentication
3. Role System
4. API Base URL and Headers
5. Endpoints Reference
6. Error Handling
7. UI Workflow Guide
8. Sample Data Shapes

---

## 1. Overview

This document describes every API endpoint implemented in branch `ibtida01` for the collaboration management and role-based access control features. All endpoints are under the `/repos/{repo_id}/` prefix.

The features covered are:

- Inviting another HitGub user to collaborate on a repository
- The invitee accepting or rejecting the invitation
- Listing all collaborators on a repository
- Changing a collaborator's role (owner-only action)
- Removing a collaborator from a repository
- Transferring full ownership of a repository to another collaborator
- Querying the current logged-in user's role on any repository
- Querying the current user's read/write/admin access level

---

## 2. Authentication

All collaboration endpoints require the user to be logged in. After a successful call to `POST /auth/login`, the server returns a token:

```json
{
  "token": "550e8400-e29b-41d4-a716-446655440000"
}
```

Every subsequent request to a protected endpoint must include this token in the `Authorization` header:

```
Authorization: Bearer 550e8400-e29b-41d4-a716-446655440000
```

If the token is missing, invalid, or expired, the server returns `401 Unauthorized`. When this happens, redirect the user to the login page.

Tokens expire after 1 hour of the login time. There is no silent refresh; the user must log in again.

---

## 3. Role System

Every collaborator on a repository is assigned exactly one of the following roles. This role determines what actions they can perform.

| Role        | Read | Write | Invite Others | Admin Actions | Delete Repo |
|-------------|------|-------|---------------|---------------|-------------|
| owner       | Yes  | Yes   | Yes           | Yes           | Yes         |
| maintainer  | Yes  | Yes   | Yes           | Yes           | No          |
| contributor | Yes  | Yes   | No            | No            | No          |
| read-only   | Yes  | No    | No            | No            | No          |
| none        | Public repos only | No | No | No | No |

**Admin actions** include: changing someone's role, removing a collaborator, and transferring ownership.

The UI should use the result of `GET /repos/{repo_id}/my-role` to decide which buttons and options to show. For example, the "Invite" button should only be rendered if the current user's role is `owner` or `maintainer`.

---

## 4. API Base URL and Headers

During local development, the server runs at:

```
http://localhost:8000
```

Every request that involves the current user must carry the header:

```
Authorization: Bearer <token>
Content-Type: application/json      (for POST / PATCH requests with a body)
```

---

## 5. Endpoints Reference

### 5.1 Invite a Collaborator

**Endpoint:** `POST /repos/{repo_id}/collaborators/invite`

**Who can call this:** owner, maintainer

**Request body:**
```json
{
  "invitee_id": 7,
  "role": "contributor"
}
```

The `role` field must be one of: `maintainer`, `contributor`, `read-only`. You cannot invite someone as `owner`.

**Success response (200):**
```json
{
  "status": "pending",
  "repo_id": 1,
  "invitee_id": 7,
  "role": "contributor",
  "invited_by": 1
}
```

**What to show in the UI:**

Display a modal or form with two fields: a user search/picker for the invitee and a role dropdown. After a successful invite, show a success toast: "Invitation sent." The collaborator will appear in the list with status `pending` until they respond.

---

### 5.2 Respond to an Invitation

**Endpoint:** `POST /repos/{repo_id}/collaborators/respond`

**Who can call this:** the invited user only

**Request body:**
```json
{
  "accept": true
}
```

Set `accept` to `false` to decline.

**Success response (200):**
```json
{
  "status": "accepted",
  "detail": { ... }
}
```

**What to show in the UI:**

When a user visits a repository page and they have a pending invitation, display a banner or notification with "Accept" and "Decline" buttons. On accept, refresh the collaborator list and show the user as an active collaborator. On decline, remove the banner.

---

### 5.3 List Collaborators

**Endpoint:** `GET /repos/{repo_id}/collaborators`

**Query parameters:**

| Parameter | Type   | Default    | Description                                                         |
|-----------|--------|------------|---------------------------------------------------------------------|
| status    | string | `accepted` | Filter by status. Values: `accepted`, `pending`, `revoked`         |

**Who can call this:** any logged-in user (read access or higher)

**Success response (200):**
```json
{
  "repo_id": 1,
  "collaborators": [
    {
      "user_id": 2,
      "username": "sadia",
      "full_name": "Sadia Islam",
      "email": "sadia@example.com",
      "avatar_url": "https://...",
      "role": "maintainer",
      "status": "accepted",
      "invited_by_username": "sakif"
    }
  ]
}
```

**What to show in the UI:**

A table or card list showing each collaborator's avatar, name, username, role badge, and action buttons (change role, remove) that are visible only if the current user has permission. Add a tab or toggle to switch between `accepted` and `pending` views.

---

### 5.4 Change a Collaborator's Role

**Endpoint:** `PATCH /repos/{repo_id}/collaborators/{user_id}`

**Who can call this:** owner only

**Request body:**
```json
{
  "new_role": "maintainer"
}
```

The `new_role` field must be one of: `maintainer`, `contributor`, `read-only`. To make someone the owner, use the transfer ownership endpoint instead.

**Success response (200):** Returns the updated collaborator record.

**What to show in the UI:**

In the collaborator list row, show a dropdown for the role if the current user is the owner. When the user selects a new role from the dropdown, send this PATCH request. Optimistically update the UI and revert on error.

---

### 5.5 Remove a Collaborator

**Endpoint:** `DELETE /repos/{repo_id}/collaborators/{user_id}`

**Who can call this:** owner (can remove anyone except themselves), maintainer (can remove contributor or read-only only)

**No request body.**

**Success response (200):**
```json
{
  "detail": "User 7 has been removed from repository 1."
}
```

**What to show in the UI:**

Show a "Remove" button in each collaborator row. On click, show a confirmation dialog: "Remove [username] from this repository?" On confirmation, send the request. On success, remove the row from the list.

---

### 5.6 Transfer Repository Ownership

**Endpoint:** `POST /repos/{repo_id}/transfer`

**Who can call this:** owner only

**Request body:**
```json
{
  "new_owner_id": 3
}
```

The `new_owner_id` must already be an accepted collaborator of the repository. After transfer, the previous owner's role becomes `maintainer` automatically.

**Success response (200):**
```json
{
  "detail": "Ownership transferred successfully.",
  "new_owner_id": 3,
  "previous_owner_id": 1,
  "result": { ... }
}
```

**What to show in the UI:**

This is a destructive action. Place it in a "Danger Zone" section of the repository settings page. Show a confirmation modal that requires the user to type the repository name before confirming, similar to GitHub's pattern. After success, update the current user's displayed role to `maintainer` and refresh the page.

---

### 5.7 Get Current User's Role

**Endpoint:** `GET /repos/{repo_id}/my-role`

**Who can call this:** any logged-in user

**Success response (200):**
```json
{
  "user_id": 2,
  "repo_id": 1,
  "role": "maintainer"
}
```

Possible `role` values: `owner`, `maintainer`, `contributor`, `read-only`, `none`.

**What to show in the UI:**

Call this endpoint when a user opens a repository page. Use the returned role to decide which UI elements to render:

- `owner` or `maintainer`: Show the Invite button and role dropdowns in the collaborator list.
- `owner` only: Show the "Transfer Ownership" option in settings.
- `contributor` and above: Allow access to write actions (commits, PRs, etc., implemented by other team members).
- `read-only`: Show the repo contents but hide all write controls.
- `none`: On a private repo, redirect to a 404 page. On a public repo, show contents in read-only mode.

---

### 5.8 Get Current User's Full Access Level

**Endpoint:** `GET /repos/{repo_id}/access`

**Who can call this:** any logged-in user

**Success response (200):**
```json
{
  "user_id": 2,
  "repo_id": 1,
  "can_read": true,
  "can_write": true,
  "can_admin": false
}
```

Use this endpoint as an alternative to `/my-role` when you want boolean flags directly rather than having to map a role string to permission checks in the frontend.

---

## 6. Error Handling

The API returns standard HTTP status codes. The response body always contains a `detail` field with a human-readable message.

| Status Code | Meaning                                           | When it happens                                                             |
|-------------|---------------------------------------------------|-----------------------------------------------------------------------------|
| 200         | Success                                           | Request completed successfully                                              |
| 400         | Bad Request                                       | Invalid input, generic PyGit error                                          |
| 401         | Unauthorized                                      | Missing, invalid, or expired Bearer token                                   |
| 403         | Forbidden                                         | The user does not have the required role to perform this action              |
| 404         | Not Found                                         | Repository or user does not exist                                           |
| 409         | Conflict                                          | Duplicate action (e.g., inviting a user who is already a collaborator)      |
| 422         | Unprocessable Entity                              | Validation error (e.g., invalid role name)                                  |
| 500         | Internal Server Error                             | Unexpected database or server error                                         |

**Error response shape:**
```json
{
  "detail": "You need admin access to do this."
}
```

**Frontend recommendation:** For 401, silently redirect to `/login`. For 403, display a toast: "You do not have permission to do this." For 409, display: "This action has already been taken." For all others, display a generic error message and log the details to the console.

---

## 7. UI Workflow Guide

### Flow 1: Owner invites a new collaborator

1. Owner opens the repository's "Collaborators" tab.
2. Frontend calls `GET /repos/{repo_id}/my-role` to confirm the user is owner or maintainer.
3. Owner clicks "Invite Collaborator", selects a user and a role.
4. Frontend sends `POST /repos/{repo_id}/collaborators/invite`.
5. Show a success message. The new collaborator now appears in the pending list.

### Flow 2: Invitee responds to the invitation

1. The invitee logs in and sees a notification badge.
2. They navigate to the repository or a notifications page.
3. Frontend displays a banner with "Accept" and "Decline" buttons.
4. On click, frontend sends `POST /repos/{repo_id}/collaborators/respond` with `accept: true` or `false`.
5. On success, update the UI accordingly.

### Flow 3: Owner changes a collaborator's role

1. Owner opens the "Collaborators" tab.
2. Owner sees a role dropdown next to each collaborator (visible only when the logged-in user is owner).
3. Owner selects a new role from the dropdown.
4. Frontend sends `PATCH /repos/{repo_id}/collaborators/{user_id}`.
5. On success, update the role badge in the row.

### Flow 4: Owner transfers repository ownership

1. Owner opens repository settings.
2. In the "Danger Zone" section, clicks "Transfer Ownership".
3. A modal appears listing current accepted collaborators. Owner selects one.
4. Owner is asked to type the repo name to confirm.
5. Frontend sends `POST /repos/{repo_id}/transfer`.
6. On success, the previous owner's role badge updates to "maintainer" and the selected user's badge updates to "owner".

---

## 8. Sample Data Shapes

### Collaborator record (from list endpoint)

```json
{
  "user_id": 5,
  "username": "raiyan",
  "full_name": "Sakif Naieb Raiyan",
  "email": "raiyan@example.com",
  "avatar_url": "https://example.com/avatars/raiyan.png",
  "role": "contributor",
  "status": "accepted",
  "invited_by_username": "sakif"
}
```

### Role response

```json
{
  "user_id": 1,
  "repo_id": 3,
  "role": "owner"
}
```

### Access response

```json
{
  "user_id": 1,
  "repo_id": 3,
  "can_read": true,
  "can_write": true,
  "can_admin": true
}
```

---

*Document last updated by: ibtida01 (branch ibtida01)*
*For questions about backend behavior, refer to `backend/api/collaboration.py` and the py_git cheatsheet.*
