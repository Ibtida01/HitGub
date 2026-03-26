"""
╔══════════════════════════════════════════════════════════════════════════════╗
║                              py_git.py                                      ║
║          GitHub Clone — Repository & Collaborator Management Wrapper        ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Group 16 · Information System Design Sessional                             ║
║                                                                             ║
║  QUICK START                                                                ║
║  ─────────────────────────────────────────────────────────────────────────  ║
║  1. pip install psycopg2-binary python-dotenv                               ║
║                                                                             ║
║  2. Set environment variables (or pass db_config= to PyGit):               ║
║       PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD                       ║
║                                                                             ║
║  3. from py_git import PyGit                                                ║
║     git = PyGit()                                                           ║
║                                                                             ║
║  WHAT THIS FILE CONTAINS                                                    ║
║  ─────────────────────────────────────────────────────────────────────────  ║
║  Section 1 · Exceptions     — all custom error types                       ║
║  Section 2 · PyGit class    — the wrapper (import this)                    ║
║    ├─ A. Internal helpers   — DB connection, transactions, password hashing ║
║    ├─ B. User management    — create / get / update / deactivate / auth    ║
║    ├─ C. Repository mgmt    — create / list / update / delete / search     ║
║    ├─ D. Branch management  — create / protect / set default / commit info ║
║    ├─ E. Collaborator mgmt  — invite / accept / roles / remove / transfer  ║
║    └─ F. Access helpers     — role checks, permission guards               ║
╚══════════════════════════════════════════════════════════════════════════════╝

PERMISSION REFERENCE
────────────────────
Role           │ Read  │ Write │ Invite │ Admin │ Delete repo
───────────────┼───────┼───────┼────────┼───────┼────────────
owner          │  ✓    │  ✓    │  ✓     │  ✓    │  ✓
contributor    │  ✓    │  ✓    │  ✗     │  ✗    │  ✗
read-only      │  ✓    │  ✗    │  ✗     │  ✗    │  ✗
(none)         │  public repos only

EXCEPTION REFERENCE
───────────────────
PyGitError            — base class, catch this to handle all py_git errors
  UserNotFoundError   — get_user() / authenticate_user() with unknown user
  RepoNotFoundError   — get_repository() with unknown repo
  BranchNotFoundError — get_branch() with unknown branch
  AccessDeniedError   — caller lacks permission  →  HTTP 403
  DuplicateError      — unique constraint violated  →  HTTP 409
  ValidationError     — bad argument value  →  HTTP 422
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import secrets
from contextlib import contextmanager
from datetime import datetime
from typing import Optional

# ── optional .env support ────────────────────────────────────────────────────
try:
    from dotenv import load_dotenv
    load_dotenv(override=True)
except ImportError:
    pass  # python-dotenv is optional; env vars can be set any other way

try:
    import psycopg2
    import psycopg2.errors
    import psycopg2.extras
except ImportError:
    raise ImportError(
        "psycopg2 is not installed.\n"
        "Fix: pip install psycopg2-binary"
    )

# ── module-level logger ───────────────────────────────────────────────────────
# In your app call: logging.basicConfig(level=logging.DEBUG)
# to see py_git connection and query logs.
logger = logging.getLogger("py_git")


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 1 · EXCEPTIONS
# ══════════════════════════════════════════════════════════════════════════════

class PyGitError(Exception):
    """
    Base class for all py_git exceptions.

    Catch this to handle every py_git error in one place:

        try:
            git.create_repository(...)
        except PyGitError as e:
            print(e)

    Or catch the specific subclass for finer control.
    """

class UserNotFoundError(PyGitError):
    """Raised when a user lookup returns no result."""

class RepoNotFoundError(PyGitError):
    """Raised when a repository lookup returns no result."""

class BranchNotFoundError(PyGitError):
    """Raised when a branch lookup returns no result."""

class AccessDeniedError(PyGitError):
    """
    Raised when the acting user lacks permission for the requested operation.
    Map to HTTP 403 in your API layer.
    """

class DuplicateError(PyGitError):
    """
    Raised when an INSERT would violate a UNIQUE constraint
    (e.g. duplicate username, duplicate repo name for same owner).
    Map to HTTP 409 in your API layer.
    """

class ValidationError(PyGitError):
    """
    Raised when an argument fails format or business-logic validation
    before even touching the database.
    Map to HTTP 422 in your API layer.
    """


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 2 · PyGit CLASS
# ══════════════════════════════════════════════════════════════════════════════

class PyGit:
    """
    Python wrapper for the GitHub Clone PostgreSQL schema.

    ──────────────────────────────────────────────────────────────────────────
    CREATING AN INSTANCE
    ──────────────────────────────────────────────────────────────────────────

        # Option 1 — reads PGHOST / PGPORT / PGDATABASE / PGUSER / PGPASSWORD
        git = PyGit()

        # Option 2 — explicit config dict (useful for tests)
        git = PyGit(db_config={
            "host": "localhost", "port": 5432,
            "dbname": "github_clone",
            "user": "postgres", "password": "secret",
        })

        # Option 3 — context manager (connection auto-closes on exit)
        with PyGit() as git:
            repo = git.create_repository(owner_id=1, name="demo")

    ──────────────────────────────────────────────────────────────────────────
    RETURNED VALUES
    ──────────────────────────────────────────────────────────────────────────

    Every method returns either:
        dict        — a single database row  (keys = column names)
        list[dict]  — multiple rows
        bool        — True for fire-and-forget operations (delete, remove…)

    Datetime columns are Python datetime objects.
    Cast with str(value) if you need JSON-serialisable strings.
    password_hash is NEVER included in any returned dict.

    ──────────────────────────────────────────────────────────────────────────
    THREAD-SAFETY NOTE
    ──────────────────────────────────────────────────────────────────────────

    One PyGit instance holds ONE database connection and is NOT thread-safe.
    In FastAPI / Django, create one instance per request (dependency injection),
    or use a connection pool library like psycopg2.pool or SQLAlchemy.
    """

    # ── validation regexes — mirror the DB CHECK constraints exactly ─────────
    _RE_USERNAME    = re.compile(r'^[a-zA-Z0-9_-]+$')
    _RE_EMAIL       = re.compile(r'^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$')
    _RE_REPO_NAME   = re.compile(r'^[a-zA-Z0-9_-]+$')
    _RE_BRANCH_NAME = re.compile(r'^[a-zA-Z0-9/_-]+$')
    _RE_COMMIT_HASH = re.compile(r'^[0-9a-f]{40}$')

    # ── valid enum values — mirror the DB CHECK constraints exactly ──────────
    VALID_ROLES      = frozenset({"owner", "contributor", "read-only"})
    VALID_STATUSES   = frozenset({"pending", "accepted", "rejected", "revoked"})
    VALID_VISIBILITY = frozenset({"public", "private"})

    # ─────────────────────────────────────────────────────────────────────────
    # A. INTERNAL HELPERS
    #    Teammates: you don't need to call any of these directly.
    # ─────────────────────────────────────────────────────────────────────────

    def __init__(self, db_config: Optional[dict] = None):
        """
        Args:
            db_config: Dict with keys host, port, dbname, user, password.
                       If omitted, values are read from environment variables
                       PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD.
        """
        self._cfg = db_config or {
            "host":     os.getenv("PGHOST",     "127.0.0.1"),
            "port":     int(os.getenv("PGPORT",  "5433")),
            "dbname":   os.getenv("PGDATABASE", "hitgub"),
            "user":     os.getenv("PGUSER",     "myuser"),
            "password": os.getenv("PGPASSWORD", "mypassword"),
        }
        self._conn = None
        self._connect()

    # ── connection lifecycle ──────────────────────────────────────────────────

    def _connect(self) -> None:
        """Open (or re-open) the database connection."""
        if self._conn and not self._conn.closed:
            return
        self._conn = psycopg2.connect(**self._cfg)
        self._conn.autocommit = False
        logger.debug("py_git: database connection opened.")

    def close(self) -> None:
        """
        Close the database connection.

        Call this when you are done with the instance, or use PyGit as a
        context manager and it will be called for you automatically.

        Example:
            git = PyGit()
            # ... do work ...
            git.close()
        """
        if self._conn and not self._conn.closed:
            self._conn.close()
            logger.debug("py_git: database connection closed.")

    def __enter__(self) -> "PyGit":
        return self

    def __exit__(self, *_) -> None:
        self.close()

    # ── transaction context managers ─────────────────────────────────────────

    @contextmanager
    def _transaction(self):
        """
        Context manager for write operations.
        Yields an open cursor, commits on success, rolls back on any exception.

        Internal usage:
            with self._transaction() as cur:
                cur.execute("INSERT INTO ...")
                row = cur.fetchone()
            # commit happens here automatically
        """
        self._connect()
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            yield cur
            self._conn.commit()
        except Exception:
            self._conn.rollback()
            raise
        finally:
            cur.close()

    @contextmanager
    def _query(self):
        """
        Context manager for read-only queries (no commit needed).

        Internal usage:
            with self._query() as cur:
                cur.execute("SELECT ...")
                rows = cur.fetchall()
        """
        self._connect()
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            yield cur
        finally:
            cur.close()

    # ── password helpers ──────────────────────────────────────────────────────

    @staticmethod
    def _hash_password(plain: str) -> str:
        """
        Hash a plain-text password with a random salt using SHA-256.
        Stored format: $sha256$<hex_salt>$<hex_digest>

        NOTE for production: swap this for bcrypt.
            pip install bcrypt
            import bcrypt
            bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()
        """
        salt   = secrets.token_hex(16)
        digest = hashlib.sha256((salt + plain).encode()).hexdigest()
        return f"$sha256${salt}${digest}"

    @staticmethod
    def _verify_password(plain: str, stored_hash: str) -> bool:
        """Return True if plain-text password matches the stored hash."""
        if stored_hash.startswith("$sha256$"):
            _, _, salt, digest = stored_hash.split("$")
            return hashlib.sha256((salt + plain).encode()).hexdigest() == digest
        return False

    # ── private guard helpers ─────────────────────────────────────────────────

    def _require_role(
        self,
        actor_id: int,
        repo_id: int,
        allowed_roles: tuple,
        action: str = "perform this action",
    ) -> None:
        """
        Raise AccessDeniedError if actor_id's role is not in allowed_roles.
        Used internally at the top of permission-gated methods.
        """
        role = self.get_user_role(actor_id, repo_id)
        if role not in allowed_roles:
            raise AccessDeniedError(
                f"User {actor_id} has role '{role}' in repository {repo_id} "
                f"but needs one of {allowed_roles} to {action}."
            )

    def _safe_dict(self, row) -> dict:
        """
        Convert a DB row to a plain dict and strip password_hash.
        password_hash must never be returned to API callers.
        """
        if row is None:
            return {}
        d = dict(row)
        d.pop("password_hash", None)
        return d

    # ═════════════════════════════════════════════════════════════════════════
    # B. USER MANAGEMENT
    # ═════════════════════════════════════════════════════════════════════════

    def create_user(
        self,
        username: str,
        email: str,
        password: str,
        full_name: Optional[str] = None,
        bio: Optional[str] = None,
        avatar_url: Optional[str] = None,
    ) -> dict:
        """
        Register a new user account.

        Args:
            username:   Unique login name.
                        Allowed characters: letters, digits, underscore, hyphen.
            email:      Unique email address.
            password:   Plain-text password — hashed before storage, never stored raw.
            full_name:  Optional display name  (e.g. "Sakif Naieb Raiyan").
            bio:        Optional short biography shown on the profile page.
            avatar_url: Optional URL to a profile picture.

        Returns:
            The newly created user row dict (password_hash is excluded).

        Raises:
            ValidationError: username or email format is invalid, or password is empty.
            DuplicateError:  username or email is already taken.

        Example:
            user = git.create_user(
                username="sakif",
                email="sakif@example.com",
                password="hunter2",
                full_name="Sakif Naieb Raiyan",
            )
            print(user["user_id"])   # → 1
        """
        if not self._RE_USERNAME.match(username):
            raise ValidationError(
                f"Invalid username '{username}'. "
                "Only letters, digits, underscores (_), and hyphens (-) are allowed."
            )
        if not self._RE_EMAIL.match(email):
            raise ValidationError(f"Invalid email address: '{email}'.")
        if not password:
            raise ValidationError("Password cannot be empty.")

        sql = """
            INSERT INTO users (username, email, password_hash, full_name, bio, avatar_url)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING *;
        """
        try:
            with self._transaction() as cur:
                cur.execute(sql, (
                    username, email, self._hash_password(password),
                    full_name, bio, avatar_url,
                ))
                return self._safe_dict(cur.fetchone())
        except psycopg2.errors.UniqueViolation:
            raise DuplicateError(
                f"Username '{username}' or email '{email}' is already taken."
            )

    def get_user(
        self,
        *,
        user_id: Optional[int] = None,
        username: Optional[str] = None,
    ) -> dict:
        """
        Look up a single user. Provide exactly one keyword argument.

        Args:
            user_id:  Numeric primary key of the user.
            username: Unique login name of the user.

        Returns:
            User row dict (password_hash excluded).

        Raises:
            ValidationError:   Neither argument was provided.
            UserNotFoundError: No user matched the lookup.

        Examples:
            git.get_user(user_id=3)
            git.get_user(username="sakif")
        """
        if user_id is not None:
            sql, params, label = "SELECT * FROM users WHERE user_id = %s;", (user_id,), str(user_id)
        elif username is not None:
            sql, params, label = "SELECT * FROM users WHERE username = %s;", (username,), username
        else:
            raise ValidationError("Provide either user_id= or username=.")

        with self._query() as cur:
            cur.execute(sql, params)
            row = cur.fetchone()

        if row is None:
            raise UserNotFoundError(f"No user found: '{label}'.")
        return self._safe_dict(row)

    def update_user(self, user_id: int, **fields) -> dict:
        """
        Update one or more profile fields for a user.

        Updatable fields:
            full_name  (str)
            bio        (str)
            avatar_url (str)
            email      (str)
            is_active  (bool) — set False to soft-deactivate

        Args:
            user_id: ID of the user to update.
            **fields: Any combination of the updatable fields listed above.

        Returns:
            The updated user row (password_hash excluded).

        Raises:
            ValidationError:   No valid field names were provided.
            UserNotFoundError: user_id does not exist.
            DuplicateError:    New email is already used by another account.

        Example:
            git.update_user(3, bio="Backend dev", avatar_url="https://i.imgur.com/abc.png")
        """
        allowed = {"full_name", "bio", "avatar_url", "email", "is_active"}
        updates = {k: v for k, v in fields.items() if k in allowed}
        if not updates:
            raise ValidationError(
                f"No recognised fields supplied. "
                f"Updatable fields are: {sorted(allowed)}"
            )

        set_clause = ", ".join(f"{col} = %s" for col in updates)
        values     = [*updates.values(), user_id]

        try:
            with self._transaction() as cur:
                cur.execute(
                    f"UPDATE users SET {set_clause} WHERE user_id = %s RETURNING *;",
                    values,
                )
                row = cur.fetchone()
        except psycopg2.errors.UniqueViolation:
            raise DuplicateError("That email address is already used by another account.")

        if row is None:
            raise UserNotFoundError(f"No user found for user_id={user_id}.")
        return self._safe_dict(row)

    def deactivate_user(self, user_id: int) -> bool:
        """
        Soft-delete a user by setting is_active = FALSE.

        The user's data and their repositories are preserved. They simply
        cannot log in until the account is reactivated via update_user().

        Args:
            user_id: ID of the user to deactivate.

        Returns:
            True on success.

        Raises:
            UserNotFoundError: user_id does not exist.

        Example:
            git.deactivate_user(5)
            # Reactivate later:
            git.update_user(5, is_active=True)
        """
        with self._transaction() as cur:
            cur.execute(
                "UPDATE users SET is_active = FALSE WHERE user_id = %s RETURNING user_id;",
                (user_id,),
            )
            row = cur.fetchone()

        if row is None:
            raise UserNotFoundError(f"No user found for user_id={user_id}.")
        return True

    def authenticate_user(self, username: str, password: str) -> dict:
        """
        Verify a username + password combination.

        Args:
            username: Login name.
            password: Plain-text password to check against the stored hash.

        Returns:
            The authenticated user row (password_hash excluded) on success.

        Raises:
            AccessDeniedError: Wrong credentials OR account is deactivated.
                               Both cases raise the same error intentionally
                               to prevent username enumeration attacks.

        Example:
            try:
                user = git.authenticate_user("sakif", "mypassword")
                # user["user_id"] → use as JWT subject
            except AccessDeniedError:
                # return HTTP 401 to the client
        """
        _WRONG_CREDS = "Invalid username or password."

        with self._query() as cur:
            cur.execute("SELECT * FROM users WHERE username = %s;", (username,))
            row = cur.fetchone()

        if row is None:
            raise AccessDeniedError(_WRONG_CREDS)

        user = dict(row)
        if not user.get("is_active", False):
            raise AccessDeniedError("This account has been deactivated.")
        if not self._verify_password(password, user["password_hash"]):
            raise AccessDeniedError(_WRONG_CREDS)

        return self._safe_dict(row)

    def list_users(self, active_only: bool = True) -> list[dict]:
        """
        Return all users in the system.

        Args:
            active_only: If True (default), exclude deactivated accounts.

        Returns:
            List of user dicts sorted by user_id (password_hash excluded).

        Example:
            active_users = git.list_users()
            everyone     = git.list_users(active_only=False)
        """
        where = "WHERE is_active = TRUE" if active_only else ""
        with self._query() as cur:
            cur.execute(f"SELECT * FROM users {where} ORDER BY user_id;")
            return [self._safe_dict(r) for r in cur.fetchall()]

    # ═════════════════════════════════════════════════════════════════════════
    # C. REPOSITORY MANAGEMENT
    # ═════════════════════════════════════════════════════════════════════════

    def create_repository(
        self,
        owner_id: int,
        name: str,
        description: Optional[str] = None,
        visibility: str = "public",
        has_readme: bool = False,
        license_type: Optional[str] = None,
        default_branch: str = "main",
    ) -> dict:
        """
        Create a new repository.

        This single call atomically does three things:
          1. Creates the repository row.
          2. Creates the default branch (e.g. 'main').
          3. Registers the owner as an accepted collaborator with role 'owner'.

        Args:
            owner_id:       user_id of the user who will own the repository.
            name:           Repository name. Must be unique per owner.
                            Allowed characters: letters, digits, underscore, hyphen.
            description:    Optional short description (shown on the repo page).
            visibility:     'public' (default) or 'private'.
            has_readme:     True if a README was initialised. Default False.
            license_type:   Optional SPDX licence identifier, e.g. 'MIT', 'Apache-2.0'.
            default_branch: Name of the default branch. Default 'main'.

        Returns:
            The created repository row dict.

        Raises:
            ValidationError: name contains invalid characters or visibility is wrong.
            DuplicateError:  This owner already has a repository with this name.

        Example:
            repo = git.create_repository(
                owner_id=1,
                name="github-clone",
                description="Our ISD sessional project",
                visibility="public",
                has_readme=True,
                license_type="MIT",
            )
            print(repo["repository_id"])   # → 1
        """
        if not self._RE_REPO_NAME.match(name):
            raise ValidationError(
                f"Invalid repository name '{name}'. "
                "Only letters, digits, underscores (_), and hyphens (-) are allowed."
            )
        if visibility not in self.VALID_VISIBILITY:
            raise ValidationError(
                f"visibility must be 'public' or 'private', got '{visibility}'."
            )

        try:
            with self._transaction() as cur:
                # Step 1: create the repository row
                cur.execute(
                    """
                    INSERT INTO repositories
                        (owner_id, name, description, visibility,
                         has_readme, license_type, default_branch, is_initialized)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE)
                    RETURNING *;
                    """,
                    (owner_id, name, description, visibility,
                     has_readme, license_type, default_branch),
                )
                repo    = dict(cur.fetchone())
                repo_id = repo["repository_id"]

                # Step 2: create the default branch
                cur.execute(
                    """
                    INSERT INTO branches (repository_id, name, is_default, created_by)
                    VALUES (%s, %s, TRUE, %s);
                    """,
                    (repo_id, default_branch, owner_id),
                )

                # Step 3: register the owner as an accepted collaborator
                cur.execute(
                    """
                    INSERT INTO repository_collaborators
                        (repository_id, user_id, role, invited_by, status, accepted_at)
                    VALUES (%s, %s, 'owner', %s, 'accepted', CURRENT_TIMESTAMP);
                    """,
                    (repo_id, owner_id, owner_id),
                )

            return repo

        except psycopg2.errors.UniqueViolation:
            raise DuplicateError(
                f"You already have a repository named '{name}'. "
                "Repository names must be unique per user."
            )

    def get_repository(self, repo_id: int) -> dict:
        """
        Fetch a single repository by its primary key.

        Args:
            repo_id: Numeric repository_id.

        Returns:
            Repository row dict.

        Raises:
            RepoNotFoundError: No repository with that ID exists.

        Example:
            repo = git.get_repository(1)
            print(repo["name"], repo["visibility"])
        """
        with self._query() as cur:
            cur.execute(
                "SELECT * FROM repositories WHERE repository_id = %s;",
                (repo_id,),
            )
            row = cur.fetchone()

        if row is None:
            raise RepoNotFoundError(f"No repository found for repository_id={repo_id}.")
        return dict(row)

    def get_repository_by_name(self, owner_id: int, name: str) -> dict:
        """
        Fetch a repository by owner + name (the natural unique key pair).

        This is useful when you have a URL like /{username}/{repo_name}
        and need to look up the repository without knowing the numeric ID.

        Args:
            owner_id: user_id of the repository owner.
            name:     Repository name (exact match, case-sensitive).

        Returns:
            Repository row dict.

        Raises:
            RepoNotFoundError: No matching repository found.

        Example:
            repo = git.get_repository_by_name(owner_id=1, name="github-clone")
        """
        with self._query() as cur:
            cur.execute(
                "SELECT * FROM repositories WHERE owner_id = %s AND name = %s;",
                (owner_id, name),
            )
            row = cur.fetchone()

        if row is None:
            raise RepoNotFoundError(
                f"No repository '{name}' found for owner_id={owner_id}."
            )
        return dict(row)

    def list_repositories(
        self,
        owner_id: Optional[int] = None,
        visibility: Optional[str] = None,
    ) -> list[dict]:
        """
        List repositories with optional filtering.

        Uses the v_repositories_with_owners database view, so each row also
        includes owner_username, owner_name, and owner_avatar alongside the
        usual repository columns.

        Args:
            owner_id:   If given, only return repos owned by this user.
            visibility: If given, filter by 'public' or 'private'.

        Returns:
            List of repository dicts, newest first.

        Examples:
            git.list_repositories()                            # all repos
            git.list_repositories(owner_id=1)                 # one user's repos
            git.list_repositories(visibility="public")        # all public repos
            git.list_repositories(owner_id=1, visibility="private")
        """
        conditions, params = [], []
        if owner_id is not None:
            conditions.append("owner_id = %s")
            params.append(owner_id)
        if visibility is not None:
            if visibility not in self.VALID_VISIBILITY:
                raise ValidationError(
                    f"visibility must be 'public' or 'private', got '{visibility}'."
                )
            conditions.append("visibility = %s")
            params.append(visibility)

        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
        with self._query() as cur:
            cur.execute(
                f"SELECT * FROM v_repositories_with_owners {where} ORDER BY created_at DESC;",
                params,
            )
            return [dict(r) for r in cur.fetchall()]

    def list_user_repositories(self, user_id: int) -> list[dict]:
        """
        Return every repository a user is connected to:
        both repositories they own AND repositories they collaborate on.
        Only accepted collaborations are included.

        Uses the v_user_repositories database view.

        Args:
            user_id: The user to look up.

        Returns:
            List of repo dicts. Each dict includes a user_role field
            ('owner', 'contributor', or 'read-only').

        Example:
            repos = git.list_user_repositories(user_id=2)
            for r in repos:
                print(r["repository_name"], "→", r["user_role"])
        """
        with self._query() as cur:
            cur.execute(
                """
                SELECT * FROM v_user_repositories
                WHERE user_id = %s
                ORDER BY created_at DESC;
                """,
                (user_id,),
            )
            return [dict(r) for r in cur.fetchall()]

    def search_repositories(
        self,
        query: str,
        visibility: Optional[str] = "public",
    ) -> list[dict]:
        """
        Case-insensitive search across repository name and description.

        Args:
            query:      Search string. Partial matches are supported.
            visibility: Restrict results to 'public' or 'private', or pass
                        None to search across both. Defaults to 'public' so
                        that private repos are not accidentally leaked.

        Returns:
            Matching repository dicts from v_repositories_with_owners, newest first.

        Examples:
            git.search_repositories("clone")
            git.search_repositories("demo", visibility=None)   # includes private
        """
        sql    = """
            SELECT * FROM v_repositories_with_owners
            WHERE (name ILIKE %s OR description ILIKE %s)
        """
        params: list = [f"%{query}%", f"%{query}%"]

        if visibility is not None:
            sql += " AND visibility = %s"
            params.append(visibility)

        sql += " ORDER BY created_at DESC;"

        with self._query() as cur:
            cur.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]

    def update_repository(self, repo_id: int, **fields) -> dict:
        """
        Update one or more fields on a repository.

        Updatable fields:
            name           (str)   — new repository name
            description    (str)   — new description
            visibility     (str)   — 'public' or 'private'
            default_branch (str)   — change the default branch name
            has_readme     (bool)  — mark README presence
            license_type   (str)   — SPDX identifier

        Args:
            repo_id:  ID of the repository to update.
            **fields: Any combination of the updatable fields listed above.

        Returns:
            The updated repository row dict.

        Raises:
            ValidationError:   No valid fields supplied, or bad visibility value.
            RepoNotFoundError: repo_id does not exist.
            DuplicateError:    New name conflicts with an existing repo for this owner.

        Example:
            git.update_repository(1, description="New description", visibility="private")
        """
        allowed = {"name", "description", "visibility", "default_branch",
                   "has_readme", "license_type"}
        updates = {k: v for k, v in fields.items() if k in allowed}
        if not updates:
            raise ValidationError(
                f"No recognised fields supplied. "
                f"Updatable fields are: {sorted(allowed)}"
            )
        if "visibility" in updates and updates["visibility"] not in self.VALID_VISIBILITY:
            raise ValidationError(
                f"visibility must be 'public' or 'private', got '{updates['visibility']}'."
            )

        set_clause = ", ".join(f"{col} = %s" for col in updates)
        values     = [*updates.values(), repo_id]

        try:
            with self._transaction() as cur:
                cur.execute(
                    f"UPDATE repositories SET {set_clause} "
                    "WHERE repository_id = %s RETURNING *;",
                    values,
                )
                row = cur.fetchone()
        except psycopg2.errors.UniqueViolation:
            raise DuplicateError(
                "Another repository with this name already exists for this owner."
            )

        if row is None:
            raise RepoNotFoundError(f"No repository found for repository_id={repo_id}.")
        return dict(row)

    def delete_repository(self, repo_id: int, actor_id: int) -> bool:
        """
        Permanently delete a repository.

        All branches and collaborator records are also deleted automatically
        by the database CASCADE rules.

        Args:
            repo_id:  ID of the repository to delete.
            actor_id: user_id of the person requesting deletion.
                      Must be the repository owner.

        Returns:
            True on success.

        Raises:
            RepoNotFoundError: repo_id does not exist.
            AccessDeniedError: actor_id is not the owner.

        Example:
            git.delete_repository(repo_id=2, actor_id=1)
        """
        repo = self.get_repository(repo_id)   # raises RepoNotFoundError if missing
        if repo["owner_id"] != actor_id:
            raise AccessDeniedError(
                "Only the repository owner can delete a repository."
            )
        with self._transaction() as cur:
            cur.execute(
                "DELETE FROM repositories WHERE repository_id = %s;",
                (repo_id,),
            )
        return True

    def get_repository_stats(self, repo_id: int) -> dict:
        """
        Return a summary for a repository including branch and collaborator counts.

        Uses the v_repository_stats database view.

        Args:
            repo_id: ID of the repository.

        Returns:
            Dict with keys:
                repository_id, name, visibility, owner_username,
                branch_count, collaborator_count, created_at

        Raises:
            RepoNotFoundError: repo_id does not exist.

        Example:
            stats = git.get_repository_stats(1)
            print(f"{stats['branch_count']} branches")
            print(f"{stats['collaborator_count']} collaborators")
        """
        with self._query() as cur:
            cur.execute(
                "SELECT * FROM v_repository_stats WHERE repository_id = %s;",
                (repo_id,),
            )
            row = cur.fetchone()

        if row is None:
            raise RepoNotFoundError(f"No repository found for repository_id={repo_id}.")
        return dict(row)

    # ═════════════════════════════════════════════════════════════════════════
    # D. BRANCH MANAGEMENT
    # ═════════════════════════════════════════════════════════════════════════

    def create_branch(
        self,
        repo_id: int,
        name: str,
        created_by: int,
        is_protected: bool = False,
    ) -> dict:
        """
        Create a new branch in a repository.

        Args:
            repo_id:      ID of the repository.
            name:         Branch name.
                          Allowed characters: letters, digits, /, _, -.
                          Common patterns: 'develop', 'feature/login', 'fix/bug-42'.
            created_by:   user_id of the person creating the branch.
            is_protected: If True, the branch cannot be deleted until unprotected.
                          Default False.

        Returns:
            The created branch row dict.

        Raises:
            ValidationError: name contains invalid characters.
            DuplicateError:  A branch with this name already exists in the repo.

        Example:
            branch = git.create_branch(
                repo_id=1,
                name="feature/user-auth",
                created_by=2,
            )
        """
        if not self._RE_BRANCH_NAME.match(name):
            raise ValidationError(
                f"Invalid branch name '{name}'. "
                "Allowed characters: letters, digits, forward slash (/), underscore (_), hyphen (-)."
            )

        try:
            with self._transaction() as cur:
                cur.execute(
                    """
                    INSERT INTO branches (repository_id, name, is_protected, created_by)
                    VALUES (%s, %s, %s, %s)
                    RETURNING *;
                    """,
                    (repo_id, name, is_protected, created_by),
                )
                return dict(cur.fetchone())
        except psycopg2.errors.UniqueViolation:
            raise DuplicateError(
                f"A branch named '{name}' already exists in repository {repo_id}."
            )

    def get_branch(self, repo_id: int, branch_name: str) -> dict:
        """
        Fetch a single branch by repository + name.

        Args:
            repo_id:     ID of the repository.
            branch_name: Exact branch name.

        Returns:
            Branch row dict.

        Raises:
            BranchNotFoundError: No matching branch found.

        Example:
            branch = git.get_branch(repo_id=1, branch_name="main")
            print(branch["is_protected"])
        """
        with self._query() as cur:
            cur.execute(
                "SELECT * FROM branches WHERE repository_id = %s AND name = %s;",
                (repo_id, branch_name),
            )
            row = cur.fetchone()

        if row is None:
            raise BranchNotFoundError(
                f"Branch '{branch_name}' not found in repository {repo_id}."
            )
        return dict(row)

    def list_branches(self, repo_id: int) -> list[dict]:
        """
        List all branches of a repository.

        Args:
            repo_id: ID of the repository.

        Returns:
            List of branch dicts. The default branch is always first;
            remaining branches are sorted alphabetically.

        Example:
            for branch in git.list_branches(1):
                star = " ★" if branch["is_default"] else ""
                print(branch["name"] + star)
        """
        with self._query() as cur:
            cur.execute(
                """
                SELECT * FROM branches
                WHERE repository_id = %s
                ORDER BY is_default DESC, name;
                """,
                (repo_id,),
            )
            return [dict(r) for r in cur.fetchall()]

    def delete_branch(self, repo_id: int, branch_name: str) -> bool:
        """
        Delete a branch from a repository.

        Two safety guards are enforced:
          • The default branch cannot be deleted
            (change it first with set_default_branch()).
          • A protected branch cannot be deleted
            (unprotect it first with protect_branch(..., protect=False)).

        Args:
            repo_id:     ID of the repository.
            branch_name: Name of the branch to delete.

        Returns:
            True on success.

        Raises:
            BranchNotFoundError: Branch does not exist.
            ValidationError:     Attempting to delete the default branch.
            AccessDeniedError:   Attempting to delete a protected branch.

        Example:
            git.delete_branch(repo_id=1, branch_name="feature/old-stuff")
        """
        branch = self.get_branch(repo_id, branch_name)
        if branch["is_default"]:
            raise ValidationError(
                f"'{branch_name}' is the default branch and cannot be deleted. "
                "Use set_default_branch() to change the default first."
            )
        if branch["is_protected"]:
            raise AccessDeniedError(
                f"'{branch_name}' is protected and cannot be deleted. "
                "Use protect_branch(..., protect=False) to unprotect it first."
            )

        with self._transaction() as cur:
            cur.execute(
                "DELETE FROM branches WHERE branch_id = %s;",
                (branch["branch_id"],),
            )
        return True

    def protect_branch(
        self, repo_id: int, branch_name: str, protect: bool = True
    ) -> dict:
        """
        Enable or disable protection on a branch.

        Protected branches cannot be deleted until unprotected.
        By convention, your workflow should also require pull requests
        before merging into a protected branch.

        Args:
            repo_id:     ID of the repository.
            branch_name: Name of the branch.
            protect:     True to protect (default), False to unprotect.

        Returns:
            The updated branch row dict.

        Raises:
            BranchNotFoundError: Branch does not exist.

        Examples:
            git.protect_branch(1, "main")                    # protect
            git.protect_branch(1, "main", protect=False)     # unprotect
        """
        with self._transaction() as cur:
            cur.execute(
                """
                UPDATE branches SET is_protected = %s
                WHERE repository_id = %s AND name = %s
                RETURNING *;
                """,
                (protect, repo_id, branch_name),
            )
            row = cur.fetchone()

        if row is None:
            raise BranchNotFoundError(
                f"Branch '{branch_name}' not found in repository {repo_id}."
            )
        return dict(row)

    def set_default_branch(
        self, repo_id: int, branch_name: str, actor_id: int
    ) -> dict:
        """
        Change which branch is the default for a repository.

        Also syncs repositories.default_branch to match.
        Only owners  may call this.

        Args:
            repo_id:     ID of the repository.
            branch_name: Name of the branch to make default.
            actor_id:    user_id of the person making the change.
                         Must be owner.

        Returns:
            The updated branch row dict (the new default branch).

        Raises:
            BranchNotFoundError: branch_name does not exist in this repo.
            AccessDeniedError:   actor_id is not owner 

        Example:
            git.set_default_branch(repo_id=1, branch_name="develop", actor_id=1)
        """
        self._require_role(actor_id, repo_id, ("owner" ),
                           "change the default branch")

        new_branch = self.get_branch(repo_id, branch_name)  # validates existence

        with self._transaction() as cur:
            cur.execute(
                "UPDATE branches SET is_default = FALSE WHERE repository_id = %s;",
                (repo_id,),
            )
            cur.execute(
                "UPDATE branches SET is_default = TRUE WHERE branch_id = %s RETURNING *;",
                (new_branch["branch_id"],),
            )
            updated = dict(cur.fetchone())
            # Keep repositories.default_branch in sync
            cur.execute(
                "UPDATE repositories SET default_branch = %s WHERE repository_id = %s;",
                (branch_name, repo_id),
            )

        return updated

    def update_commit_info(
        self,
        repo_id: int,
        branch_name: str,
        commit_hash: str,
        commit_at: Optional[datetime] = None,
    ) -> dict:
        """
        Record the latest commit on a branch.

        Call this whenever a push event is received in your git integration layer.

        Args:
            repo_id:     ID of the repository.
            branch_name: Name of the branch being updated.
            commit_hash: 40-character lowercase hexadecimal SHA-1 commit hash.
            commit_at:   Timestamp of the commit. Defaults to now (UTC).

        Returns:
            The updated branch row dict.

        Raises:
            ValidationError:     commit_hash is not a valid 40-char SHA-1 string.
            BranchNotFoundError: Branch does not exist.

        Example:
            git.update_commit_info(
                repo_id=1,
                branch_name="main",
                commit_hash="d3adb33fd3adb33fd3adb33fd3adb33fd3adb33f",
            )
        """
        if not self._RE_COMMIT_HASH.match(commit_hash):
            raise ValidationError(
                f"'{commit_hash}' is not a valid commit hash. "
                "Expected a 40-character lowercase hexadecimal SHA-1 string, "
                "e.g. 'a3f1c9e2d8b74056fa21c3e9b07d5812e4a9c0f1'."
            )

        ts = commit_at or datetime.utcnow()

        with self._transaction() as cur:
            cur.execute(
                """
                UPDATE branches
                SET last_commit_hash = %s, last_commit_at = %s
                WHERE repository_id = %s AND name = %s
                RETURNING *;
                """,
                (commit_hash, ts, repo_id, branch_name),
            )
            row = cur.fetchone()

        if row is None:
            raise BranchNotFoundError(
                f"Branch '{branch_name}' not found in repository {repo_id}."
            )
        return dict(row)

    # ═════════════════════════════════════════════════════════════════════════
    # E. COLLABORATOR MANAGEMENT
    # ═════════════════════════════════════════════════════════════════════════

    def invite_collaborator(
        self,
        repo_id: int,
        invitee_id: int,
        role: str,
        invited_by: int,
    ) -> dict:
        """
        Invite a user to collaborate on a repository.

        The invitation is created with status='pending'. The invitee must call
        respond_to_invitation() to accept or reject it before gaining access.

        Invitable roles:  'contributor', 'read-only'.
        ('owner' cannot be assigned this way — use transfer_ownership().)

        Args:
            repo_id:    ID of the repository.
            invitee_id: user_id of the person being invited.
            role:       Role to grant upon acceptance.
            invited_by: user_id of the person sending the invitation.
                        Must be owner.

        Returns:
            The new collaborator row dict (status='pending').

        Raises:
            ValidationError:   role is 'owner' or not a valid role string.
            AccessDeniedError: invited_by is not owner .
            DuplicateError:    invitee_id already has a record for this repo
                               (even if pending or revoked).

        Example:
            invite = git.invite_collaborator(
                repo_id=1,
                invitee_id=4,
                role="contributor",
                invited_by=1,
            )
            print(invite["status"])   # → 'pending'
        """
        if role not in self.VALID_ROLES:
            raise ValidationError(
                f"'{role}' is not a valid role. "
                f"Choose from: {sorted(self.VALID_ROLES - {'owner'})}"
            )
        if role == "owner":
            raise ValidationError(
                "Cannot invite someone directly as 'owner'. "
                "Use transfer_ownership() to hand over the repository instead."
            )

        self._require_role(invited_by, repo_id, ("owner"),
                           "invite collaborators")

        try:
            with self._transaction() as cur:
                cur.execute(
                    """
                    INSERT INTO repository_collaborators
                        (repository_id, user_id, role, invited_by, status)
                    VALUES (%s, %s, %s, %s, 'pending')
                    RETURNING *;
                    """,
                    (repo_id, invitee_id, role, invited_by),
                )
                return dict(cur.fetchone())
        except psycopg2.errors.UniqueViolation:
            raise DuplicateError(
                f"User {invitee_id} already has a collaborator record for repository {repo_id}. " 
            )

    def respond_to_invitation(
        self, repo_id: int, user_id: int, accept: bool
    ) -> dict:
        """
        Accept or reject a pending collaboration invitation.

        This should be called by the invitee (the user who received the invite),
        not by the person who sent it.

        Args:
            repo_id: ID of the repository the invitation is for.
            user_id: ID of the user responding (their own invitation).
            accept:  True to accept, False to reject.

        Returns:
            The updated collaborator row dict.

        Raises:
            PyGitError: No pending invitation found for this user + repo pair.

        Examples:
            git.respond_to_invitation(repo_id=1, user_id=4, accept=True)
            git.respond_to_invitation(repo_id=1, user_id=4, accept=False)
        """
        new_status = "accepted" if accept else "rejected"

        if accept:
            sql = """
                UPDATE repository_collaborators
                SET status = %s, accepted_at = CURRENT_TIMESTAMP
                WHERE repository_id = %s AND user_id = %s AND status = 'pending'
                RETURNING *;
            """
        else:
            sql = """
                UPDATE repository_collaborators
                SET status = %s
                WHERE repository_id = %s AND user_id = %s AND status = 'pending'
                RETURNING *;
            """

        with self._transaction() as cur:
            cur.execute(sql, (new_status, repo_id, user_id))
            row = cur.fetchone()

        if row is None:
            raise PyGitError(
                f"No pending invitation found for user {user_id} "
                f"in repository {repo_id}."
            )
        return dict(row)

    
    def remove_collaborator(
        self, repo_id: int, user_id: int, actor_id: int
    ) -> bool:
        """
        Revoke a collaborator's access to a repository.

        The collaborator record is kept (status → 'revoked') for audit purposes.
        The user simply loses access.

        Permission rules:
            owner      → can remove anyone except themselves 

        Args:
            repo_id:  ID of the repository.
            user_id:  ID of the collaborator to remove.
            actor_id: ID of the user performing the removal.

        Returns:
            True on success.

        Raises:
            ValidationError:   The owner tries to remove themselves.
            AccessDeniedError: actor_id does not have permission to remove user_id.
            PyGitError:        user_id has no collaborator record for this repo.

        Example:
            git.remove_collaborator(repo_id=1, user_id=3, actor_id=1)
        """
        actor_role  = self.get_user_role(actor_id, repo_id)
        target_role = self.get_user_role(user_id,  repo_id)

        if user_id == actor_id and target_role == "owner":
            raise ValidationError(
                "The owner cannot remove themselves. "
                "Transfer ownership first with transfer_ownership(), "
                "then remove your old account from the collaborators."
            )

        can_remove = (
            actor_role == "owner" 
        )
        if not can_remove:
            raise AccessDeniedError(
                f"A '{actor_role}' cannot remove a '{target_role}'. "
                "Owners can remove anyone; " 
            )

        with self._transaction() as cur:
            cur.execute(
                """
                UPDATE repository_collaborators SET status = 'revoked'
                WHERE repository_id = %s AND user_id = %s
                RETURNING collaboration_id;
                """,
                (repo_id, user_id),
            )
            row = cur.fetchone()

        if row is None:
            raise PyGitError(
                f"User {user_id} has no collaborator record in repository {repo_id}."
            )
        return True

    def list_collaborators(
        self,
        repo_id: int,
        status: Optional[str] = "accepted",
    ) -> list[dict]:
        """
        List collaborators for a repository.

        Uses v_repository_collaborators_detailed, so each row includes full
        user details: username, full_name, email, avatar_url, and the name
        of whoever sent the invitation.

        Args:
            repo_id: ID of the repository.
            status:  Filter by invitation status:
                       'accepted' (default) — currently active collaborators
                       'pending'            — invitations awaiting a response
                       'rejected'           — invitations that were declined
                       'revoked'            — collaborators who were removed
                       None                 — return all records regardless of status

        Returns:
            List of detailed collaborator dicts, sorted by role then username.

        Raises:
            ValidationError: status is not one of the recognised values.

        Examples:
            active_collabs = git.list_collaborators(1)
            pending_invites = git.list_collaborators(1, status="pending")
            full_history    = git.list_collaborators(1, status=None)
        """
        if status is not None and status not in self.VALID_STATUSES:
            raise ValidationError(
                f"'{status}' is not a valid status. "
                f"Choose from: {sorted(self.VALID_STATUSES)}, or pass None for all."
            )

        sql    = ("SELECT * FROM v_repository_collaborators_detailed "
                  "WHERE repository_id = %s")
        params: list = [repo_id]

        if status is not None:
            sql += " AND status = %s"
            params.append(status)

        sql += " ORDER BY role, username;"

        with self._query() as cur:
            cur.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]

    def transfer_ownership(
        self,
        repo_id: int,
        current_owner_id: int,
        new_owner_id: int,
    ) -> dict:
        """
        Transfer ownership of a repository to another collaborator.

        After the transfer:
            new_owner_id      → role becomes 'owner'
            current_owner_id  → role becomes 'collaborator'
            repositories.owner_id is updated to new_owner_id

        The new owner must already be an accepted collaborator before this
        can be called.

        Args:
            repo_id:          ID of the repository.
            current_owner_id: user_id of the current owner (authorisation check).
            new_owner_id:     user_id of the collaborator receiving ownership.

        Returns:
            The updated repository row dict.

        Raises:
            RepoNotFoundError: repo_id does not exist.
            AccessDeniedError: current_owner_id is not the owner.
            PyGitError:        new_owner_id is not an accepted collaborator.

        Example:
            # Make sure user 2 is already an accepted collaborator, then:
            git.transfer_ownership(
                repo_id=1,
                current_owner_id=1,
                new_owner_id=2,
            )
        """
        repo = self.get_repository(repo_id)
        if repo["owner_id"] != current_owner_id:
            raise AccessDeniedError(
                "Only the current owner can transfer ownership."
            )

        record = self._get_collaborator_record(repo_id, new_owner_id)
        if record is None or record["status"] != "accepted":
            raise PyGitError(
                f"User {new_owner_id} must be an accepted collaborator "
                "before they can receive ownership. "
                "Invite them with invite_collaborator() and have them accept first."
            )

        with self._transaction() as cur:
            cur.execute(
                """UPDATE repository_collaborators SET role = 'collaborator'
                   WHERE repository_id = %s AND user_id = %s;""",
                (repo_id, current_owner_id),
            )
            cur.execute(
                """UPDATE repository_collaborators SET role = 'owner'
                   WHERE repository_id = %s AND user_id = %s;""",
                (repo_id, new_owner_id),
            )
            cur.execute(
                """UPDATE repositories SET owner_id = %s
                   WHERE repository_id = %s RETURNING *;""",
                (new_owner_id, repo_id),
            )
            return dict(cur.fetchone())

    def _get_collaborator_record(
        self, repo_id: int, user_id: int
    ) -> Optional[dict]:
        """Internal: fetch raw collaborator row (any status) or None."""
        with self._query() as cur:
            cur.execute(
                """SELECT * FROM repository_collaborators
                   WHERE repository_id = %s AND user_id = %s;""",
                (repo_id, user_id),
            )
            row = cur.fetchone()
        return dict(row) if row else None

    # ═════════════════════════════════════════════════════════════════════════
    # F. ACCESS HELPERS
    # ═════════════════════════════════════════════════════════════════════════

    def get_user_role(self, user_id: int, repo_id: int) -> str:
        """
        Return the role the user holds in the repository.

        Delegates to the DB function get_user_repo_role().

        Possible return values:
            'owner'       — owns the repository 
            'contributor' — write-level collaborator
            'read-only'   — read-only collaborator
            'none'        — no relationship with this repository

        Args:
            user_id: ID of the user to check.
            repo_id: ID of the repository to check against.

        Example:
            role = git.get_user_role(user_id=2, repo_id=1)
            if role == "none":
                # either 404 or 403 depending on repo visibility
        """
        with self._query() as cur:
            cur.execute(
                "SELECT get_user_repo_role(%s, %s) AS role;",
                (user_id, repo_id),
            )
            return cur.fetchone()["role"]

    def user_has_access(self, user_id: int, repo_id: int) -> bool:
        """
        Return True if the user is allowed to view the repository at all.

        Rules (enforced in DB function user_has_repo_access):
            Public repositories  — always True (anyone can view).
            Private repositories — True only if the user is the owner or
                                   has an accepted collaborator record.

        Args:
            user_id: ID of the user to check.
            repo_id: ID of the repository to check.

        Example:
            if not git.user_has_access(current_user_id, repo_id):
                raise HTTPException(403, "Access denied")
        """
        with self._query() as cur:
            cur.execute(
                "SELECT user_has_repo_access(%s, %s) AS ok;",
                (user_id, repo_id),
            )
            return bool(cur.fetchone()["ok"])

    def can_read(self, user_id: int, repo_id: int) -> bool:
        """
        Return True if the user can read/view the repository.
        Alias for user_has_access() — public repos are readable by anyone.

        Example:
            if not git.can_read(user_id, repo_id):
                raise HTTPException(403)
        """
        return self.user_has_access(user_id, repo_id)

    def can_write(self, user_id: int, repo_id: int) -> bool:
        """
        Return True if the user can push / create branches / update files.
        Requires role: owner, or contributor.

        Example:
            if not git.can_write(current_user_id, repo_id):
                raise HTTPException(403, "Write access required")
        """
        return self.get_user_role(user_id, repo_id) in (
            "owner", "contributor"
        )

    def can_admin(self, user_id: int, repo_id: int) -> bool:
        """
        Return True if the user has admin access to the repository.
        Requires role: owner.
        Admin actions include: changing settings, inviting users, protecting branches.

        Example:
            if not git.can_admin(current_user_id, repo_id):
                raise HTTPException(403, "Admin access required")
        """
        return self.get_user_role(user_id, repo_id) in ("owner")

    def count_user_repos(self, user_id: int) -> dict:
        """
        Return repository counts for a user.

        Delegates to the DB function count_user_repositories().

        Args:
            user_id: ID of the user.

        Returns:
            Dict with two keys:
                owned_count        (int) — repositories this user owns
                collaborated_count (int) — repositories they collaborate on
                                           (accepted invitations only)

        Example:
            counts = git.count_user_repos(1)
            print(f"Owns {counts['owned_count']} repos, "
                  f"collaborates on {counts['collaborated_count']} others")
        """
        with self._query() as cur:
            cur.execute(
                "SELECT * FROM count_user_repositories(%s);",
                (user_id,),
            )
            row = cur.fetchone()
        return dict(row) if row else {"owned_count": 0, "collaborated_count": 0}