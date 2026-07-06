DROP DATABASE IF EXISTS chronoMAD;
CREATE DATABASE chronoMAD;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE utilisateurs (
    id SERIAL PRIMARY KEY,
    nom VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    mot_de_passe TEXT NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'employe',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_role CHECK (role IN ('admin', 'employe'))
);

CREATE TABLE clients (
    id SERIAL PRIMARY KEY,
    nom VARCHAR(255) NOT NULL,
    hourly_rate_defaut DECIMAL(10, 2) CHECK (hourly_rate_defaut >= 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE projets (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL,
    nom VARCHAR(255) NOT NULL,
    taux_horaire DECIMAL(10, 2) CHECK (taux_horaire >= 0),
    est_actif BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_client
        FOREIGN KEY (client_id)
        REFERENCES clients(id)
        ON DELETE CASCADE
);

CREATE TABLE time_entries (
    id SERIAL PRIMARY KEY,
    projet_id INTEGER NOT NULL,
    utilisateur_id INTEGER NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP,
    description TEXT,
    is_billed BOOLEAN DEFAULT FALSE,
    distance_km DECIMAL(10, 2) DEFAULT 0 CHECK (distance_km >= 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_projet
        FOREIGN KEY (projet_id)
        REFERENCES projets(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_utilisateur
        FOREIGN KEY (utilisateur_id)
        REFERENCES utilisateurs(id)
        ON DELETE CASCADE,

    CONSTRAINT chk_time
        CHECK (end_time IS NULL OR end_time >= start_time)
);

CREATE TABLE activity_logs (
    id SERIAL PRIMARY KEY,
    utilisateur_id INTEGER NOT NULL,
    app_name VARCHAR(255),
    window_title TEXT,
    duration_seconds INTEGER CHECK (duration_seconds >= 0),
    captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_user_log
        FOREIGN KEY (utilisateur_id)
        REFERENCES utilisateurs(id)
        ON DELETE CASCADE
);

CREATE INDEX idx_utilisateurs_email ON utilisateurs(email);
CREATE INDEX idx_projets_client_id ON projets(client_id);
CREATE INDEX idx_time_entries_projet_id ON time_entries(projet_id);
CREATE INDEX idx_time_entries_user_id ON time_entries(utilisateur_id);
CREATE INDEX idx_time_entries_start_time ON time_entries(start_time);
CREATE INDEX idx_activity_logs_user_id ON activity_logs(utilisateur_id);


INSERT INTO utilisateurs (nom, email, mot_de_passe, role)
VALUES 
    ('SuperAdmin', 'bleeband@gmail.com', 'hashed_password', 'admin'),
    ('Admin', 'admin@test.com', 'hashed_password', 'admin'),
    ('Kim', 'kim@kim.com', 'hashed_password', 'admin'),
    ('User', 'user@test.com', 'hashed_password', 'employe'),
    ('User2', 'user2@test.com', 'hashed_password', 'employe');

INSERT INTO clients (nom, hourly_rate_defaut)
VALUES 
    ('Hydro Québec', 120.00),
    ('Ubisoft', 150.00);

INSERT INTO projets (client_id, nom, taux_horaire, est_actif)
VALUES 
    (1, 'Migration système', 130.00, TRUE),
    (2, 'Jeu AAA secret', 160.00, TRUE);

INSERT INTO time_entries (
    projet_id,
    utilisateur_id,
    start_time,
    end_time,
    description,
    is_billed,
    distance_km
)
VALUES 
(
    1,
    2,
    NOW() - INTERVAL '2 hours',
    NOW() - INTERVAL '1 hour',
    'Fix bug API login',
    FALSE,
    0
),
(
    2,
    2,
    NOW() - INTERVAL '5 hours',
    NOW() - INTERVAL '3 hours',
    'Implémentation feature gameplay',
    TRUE,
    12.5
);

INSERT INTO activity_logs (
    utilisateur_id,
    app_name,
    window_title,
    duration_seconds
)
VALUES 
(2, 'VS Code', 'backend/index.js', 3600),
(2, 'Chrome', 'StackOverflow - Fix bug', 1800);