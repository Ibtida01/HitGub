DROP TABLE IF EXISTS branch_directories CASCADE;

DROP TABLE IF EXISTS branch_files CASCADE;

DROP TABLE IF EXISTS branch_commits CASCADE;

DROP TABLE IF EXISTS repository_collaborators CASCADE;

DROP TABLE IF EXISTS notifications CASCADE;

DROP TABLE IF EXISTS branches CASCADE;

DROP TABLE IF EXISTS repositories CASCADE;

DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100),
    bio TEXT,
    avatar_url VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    CONSTRAINT username_format CHECK (username ~ '^[a-zA-Z0-9_-]+$'),
    CONSTRAINT email_format CHECK (
        email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    )
);

CREATE TABLE repositories (
    repository_id SERIAL PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    visibility VARCHAR(10) DEFAULT 'public' CHECK (
        visibility IN ('public', 'private')
    ),
    default_branch VARCHAR(100) DEFAULT 'main',
    is_initialized BOOLEAN DEFAULT FALSE,
    has_readme BOOLEAN DEFAULT FALSE,
    license_type VARCHAR(50),
    deleted_at TIMESTAMP,
    restore_deadline TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_repo_per_owner UNIQUE (owner_id, name),
    CONSTRAINT repo_name_format CHECK (name ~ '^[a-zA-Z0-9_-]+$')
);

CREATE TABLE branches (
    branch_id SERIAL PRIMARY KEY,
    repository_id INTEGER NOT NULL REFERENCES repositories (repository_id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    is_protected BOOLEAN DEFAULT FALSE,
    is_default BOOLEAN DEFAULT FALSE,
    created_by INTEGER REFERENCES users (user_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_commit_hash VARCHAR(40),
    last_commit_at TIMESTAMP,
    CONSTRAINT unique_branch_per_repo UNIQUE (repository_id, name),
    CONSTRAINT branch_name_format CHECK (name ~ '^[a-zA-Z0-9/_-]+$')
);

CREATE TABLE branch_commits (
    commit_id BIGSERIAL PRIMARY KEY,
    repository_id INTEGER NOT NULL REFERENCES repositories (repository_id) ON DELETE CASCADE,
    branch_id INTEGER NOT NULL REFERENCES branches (branch_id) ON DELETE CASCADE,
    author_id INTEGER NOT NULL REFERENCES users (user_id),
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE branch_files (
    file_id BIGSERIAL PRIMARY KEY,
    repository_id INTEGER NOT NULL REFERENCES repositories (repository_id) ON DELETE CASCADE,
    branch_id INTEGER NOT NULL REFERENCES branches (branch_id) ON DELETE CASCADE,
    path VARCHAR(1024) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(255),
    size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
    content BYTEA NOT NULL,
    uploaded_by INTEGER NOT NULL REFERENCES users (user_id),
    commit_id BIGINT REFERENCES branch_commits (commit_id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_branch_file_path UNIQUE (branch_id, path)
);

CREATE TABLE branch_directories (
    directory_id BIGSERIAL PRIMARY KEY,
    repository_id INTEGER NOT NULL REFERENCES repositories (repository_id) ON DELETE CASCADE,
    branch_id INTEGER NOT NULL REFERENCES branches (branch_id) ON DELETE CASCADE,
    path VARCHAR(1024) NOT NULL,
    name VARCHAR(255) NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users (user_id),
    last_touched_by INTEGER NOT NULL REFERENCES users (user_id),
    commit_id BIGINT REFERENCES branch_commits (commit_id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_branch_directory_path UNIQUE (branch_id, path)
);

CREATE TABLE repository_collaborators (
    collaboration_id SERIAL PRIMARY KEY,
    repository_id INTEGER NOT NULL REFERENCES repositories (repository_id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (
        role IN (
            'owner',
            'contributor',
            'read-only'
        )
    ),
    invited_by INTEGER REFERENCES users (user_id),
    invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    accepted_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'pending' CHECK (
        status IN (
            'pending',
            'accepted',
            'rejected'
        )
    ),
    CONSTRAINT unique_user_repo_collab UNIQUE (repository_id, user_id)
);

CREATE TABLE notifications (
    notification_id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    repository_id INTEGER REFERENCES repositories (repository_id) ON DELETE SET NULL,
    collaboration_id INTEGER REFERENCES repository_collaborators (collaboration_id) ON DELETE SET NULL,
    actor_id INTEGER REFERENCES users (user_id) ON DELETE SET NULL,
    type VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_username ON users (username);

CREATE INDEX idx_users_email ON users (email);

CREATE INDEX idx_users_active ON users (is_active);

CREATE INDEX idx_repos_owner ON repositories (owner_id);

CREATE INDEX idx_repos_visibility ON repositories (visibility);

CREATE INDEX idx_repos_name ON repositories (name);

CREATE INDEX idx_branches_repo ON branches (repository_id);

CREATE INDEX idx_branches_default ON branches (is_default);

CREATE INDEX idx_branch_commits_branch_created ON branch_commits (branch_id, created_at);

CREATE INDEX idx_branch_files_branch_path ON branch_files (branch_id, path);

CREATE INDEX idx_branch_directories_branch_path ON branch_directories (branch_id, path);

CREATE INDEX idx_collab_repo ON repository_collaborators (repository_id);

CREATE INDEX idx_collab_user ON repository_collaborators (user_id);

CREATE INDEX idx_collab_role ON repository_collaborators (role);

CREATE INDEX idx_collab_status ON repository_collaborators (status);

CREATE INDEX idx_notifications_user_created ON notifications (user_id, created_at DESC);

CREATE INDEX idx_notifications_user_unread ON notifications (user_id, is_read);

CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_timestamp
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_repositories_timestamp
    BEFORE UPDATE ON repositories
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- INSERT INTO
--     users (
--         username,
--         email,
--         password_hash,
--         full_name
--     )
-- VALUES (
--         'shakshor',
--         'shakshor@example.com',
--         '$2b$10$dummy_hash_1',
--         'Sadik Mahamud Shakshor'
--     ),
--     (
--         'sakif',
--         'sakif@example.com',
--         '$2b$10$dummy_hash_2',
--         'Sakif Naieb Raiyan'
--     ),
--     (
--         'masfi',
--         'masfi@example.com',
--         '$2b$10$dummy_hash_3',
--         'Sayaad Muzahid Masfi'
--     ),
--     (
--         'aurchi',
--         'aurchi@example.com',
--         '$2b$10$dummy_hash_4',
--         'Aurchi Chowdhury'
--     ),
--     (
--         'ibtida',
--         'ibtida@example.com',
--         '$2b$10$dummy_hash_5',
--         'Ibtida bin Ahmed'
--     ),
--     (
--         'saif',
--         'saif@example.com',
--         '$2b$10$dummy_hash_6',
--         'Saif uz Zaman'
--     );

-- INSERT INTO
--     repositories (
--         owner_id,
--         name,
--         description,
--         visibility,
--         has_readme
--     )
-- VALUES (
--         1,
--         'github-clone',
--         'Repository management and collaboration system',
--         'public',
--         TRUE
--     ),
--     (
--         1,
--         'demo-project',
--         'A demo project for testing',
--         'private',
--         FALSE
--     ),
--     (
--         2,
--         'sakif-portfolio',
--         'Personal portfolio website',
--         'public',
--         TRUE
--     );

-- INSERT INTO
--     branches (
--         repository_id,
--         name,
--         is_default,
--         created_by
--     )
-- VALUES (1, 'main', TRUE, 1),
--     (1, 'develop', FALSE, 1),
--     (1, 'feature/auth', FALSE, 1),
--     (2, 'main', TRUE, 1),
--     (3, 'main', TRUE, 2);

-- UPDATE repositories
-- SET
--     is_initialized = TRUE,
--     default_branch = 'main'
-- WHERE
--     repository_id IN (1, 2, 3);

-- INSERT INTO
--     repository_collaborators (
--         repository_id,
--         user_id,
--         role,
--         invited_by,
--         status,
--         accepted_at
--     )
-- VALUES (
--         1,
--         1,
--         'owner',
--         1,
--         'accepted',
--         CURRENT_TIMESTAMP
--     ),
--     (
--         1,
--         2,
--         'maintainer',
--         1,
--         'accepted',
--         CURRENT_TIMESTAMP
--     ),
--     (
--         1,
--         3,
--         'contributor',
--         1,
--         'accepted',
--         CURRENT_TIMESTAMP
--     ),
--     (
--         1,
--         4,
--         'contributor',
--         1,
--         'pending',
--         NULL
--     ),
--     (
--         1,
--         5,
--         'read-only',
--         1,
--         'accepted',
--         CURRENT_TIMESTAMP
--     );

-- INSERT INTO
--     repository_collaborators (
--         repository_id,
--         user_id,
--         role,
--         invited_by,
--         status,
--         accepted_at
--     )
-- VALUES (
--         2,
--         1,
--         'owner',
--         1,
--         'accepted',
--         CURRENT_TIMESTAMP
--     ),
--     (
--         2,
--         3,
--         'maintainer',
--         1,
--         'accepted',
--         CURRENT_TIMESTAMP
--     );

-- INSERT INTO
--     repository_collaborators (
--         repository_id,
--         user_id,
--         role,
--         invited_by,
--         status,
--         accepted_at
--     )
-- VALUES (
--         3,
--         2,
--         'owner',
--         2,
--         'accepted',
--         CURRENT_TIMESTAMP
--     ),
--     (
--         3,
--         1,
--         'contributor',
--         2,
--         'accepted',
--         CURRENT_TIMESTAMP
--     );

CREATE VIEW v_repositories_with_owners AS
SELECT
    r.repository_id,
    r.name AS repo_name,
    r.description,
    r.visibility,
    r.is_initialized,
    r.default_branch,
    r.created_at,
    u.user_id AS owner_id,
    u.username AS owner_username,
    u.full_name AS owner_name,
    u.avatar_url AS owner_avatar
FROM repositories r
    JOIN users u ON r.owner_id = u.user_id;

CREATE VIEW v_repository_collaborators_detailed AS
SELECT
    rc.collaboration_id,
    rc.repository_id,
    r.name AS repository_name,
    rc.user_id,
    u.username,
    u.full_name,
    u.email,
    u.avatar_url,
    rc.role,
    rc.status,
    rc.invited_at,
    rc.accepted_at,
    inv.username AS invited_by_username
FROM
    repository_collaborators rc
    JOIN repositories r ON rc.repository_id = r.repository_id
    JOIN users u ON rc.user_id = u.user_id
    LEFT JOIN users inv ON rc.invited_by = inv.user_id;

CREATE VIEW v_repository_stats AS
SELECT
    r.repository_id,
    r.name,
    r.visibility,
    u.username AS owner_username,
    COUNT(DISTINCT b.branch_id) AS branch_count,
    COUNT(
        DISTINCT CASE
            WHEN rc.status = 'accepted' THEN rc.user_id
        END
    ) AS collaborator_count,
    r.created_at
FROM
    repositories r
    JOIN users u ON r.owner_id = u.user_id
    LEFT JOIN branches b ON r.repository_id = b.repository_id
    LEFT JOIN repository_collaborators rc ON r.repository_id = rc.repository_id
GROUP BY
    r.repository_id,
    r.name,
    r.visibility,
    u.username,
    r.created_at;

CREATE VIEW v_user_repositories AS
SELECT DISTINCT
    u.user_id,
    u.username,
    r.repository_id,
    r.name AS repository_name,
    r.visibility,
    CASE
        WHEN r.owner_id = u.user_id THEN 'owner'
        ELSE rc.role
    END AS user_role,
    r.created_at
FROM
    users u
    LEFT JOIN repositories r ON r.owner_id = u.user_id
    LEFT JOIN repository_collaborators rc ON rc.user_id = u.user_id
    AND rc.repository_id = r.repository_id
WHERE
    r.repository_id IS NOT NULL;

CREATE OR REPLACE FUNCTION user_has_repo_access(p_user_id INTEGER, p_repo_id INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
    has_access BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM repositories r
        LEFT JOIN repository_collaborators rc ON r.repository_id = rc.repository_id
        WHERE r.repository_id = p_repo_id
        AND (
            r.owner_id = p_user_id
            OR (rc.user_id = p_user_id AND rc.status = 'accepted')
            OR r.visibility = 'public'
        )
    ) INTO has_access;
    
    RETURN has_access;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_user_repo_role(p_user_id INTEGER, p_repo_id INTEGER)
RETURNS VARCHAR AS $$
DECLARE
    user_role VARCHAR(20);
BEGIN
    SELECT 
        CASE 
            WHEN r.owner_id = p_user_id THEN 'owner'
            ELSE rc.role
        END INTO user_role
    FROM repositories r
    LEFT JOIN repository_collaborators rc ON r.repository_id = rc.repository_id AND rc.user_id = p_user_id
    WHERE r.repository_id = p_repo_id;
    
    RETURN COALESCE(user_role, 'none');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION count_user_repositories(p_user_id INTEGER)
RETURNS TABLE(owned_count INTEGER, collaborated_count INTEGER) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(DISTINCT CASE WHEN r.owner_id = p_user_id THEN r.repository_id END)::INTEGER AS owned_count,
        COUNT(DISTINCT CASE WHEN rc.user_id = p_user_id AND rc.status = 'accepted' THEN r.repository_id END)::INTEGER AS collaborated_count
    FROM repositories r
    LEFT JOIN repository_collaborators rc ON r.repository_id = rc.repository_id
    WHERE r.owner_id = p_user_id OR rc.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

SELECT 'Database schema created successfully!' AS status;

SELECT 'Tables created:' AS info;

SELECT table_name
FROM information_schema.tables
WHERE
    table_schema = 'public'
    AND table_type = 'BASE TABLE'
ORDER BY table_name;

SELECT 'Views created:' AS info;

SELECT table_name
FROM information_schema.tables
WHERE
    table_schema = 'public'
    AND table_type = 'VIEW'
ORDER BY table_name;

SELECT 'Sample Users:' AS info;

SELECT user_id, username, full_name FROM users;

SELECT 'Sample Repositories:' AS info;

SELECT repository_id, name, owner_id, visibility FROM repositories;

SELECT 'Sample Branches:' AS info;

SELECT branch_id, repository_id, name, is_default FROM branches;

SELECT 'Sample Collaborators:' AS info;

SELECT
    collaboration_id,
    repository_id,
    user_id,
    role,
    status
FROM repository_collaborators;