-- 034_interac_settings.sql

ALTER TABLE organisations
ADD COLUMN interac_email VARCHAR(255),
ADD COLUMN interac_question VARCHAR(255);
