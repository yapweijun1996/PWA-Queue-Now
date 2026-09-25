CREATE TABLE merchants (
  merchant_id TEXT PRIMARY KEY NOT NULL CHECK (length(merchant_id) BETWEEN 1 AND 128),
  email_normalized TEXT NOT NULL UNIQUE
    CHECK (
      length(email_normalized) BETWEEN 3 AND 254
      AND email_normalized = lower(trim(email_normalized))
    ),
  password_hash TEXT NOT NULL CHECK (length(password_hash) BETWEEN 1 AND 1024),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE shops (
  shop_id TEXT PRIMARY KEY NOT NULL CHECK (length(shop_id) BETWEEN 1 AND 128),
  owner_merchant_id TEXT NOT NULL REFERENCES merchants(merchant_id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  timezone TEXT NOT NULL DEFAULT 'Asia/Singapore'
    CHECK (length(trim(timezone)) BETWEEN 1 AND 64),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX shops_by_owner_status ON shops (owner_merchant_id, status);

CREATE TABLE shop_staff (
  shop_id TEXT NOT NULL REFERENCES shops(shop_id) ON DELETE RESTRICT,
  merchant_id TEXT NOT NULL REFERENCES merchants(merchant_id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'MANAGER', 'STAFF')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (shop_id, merchant_id)
);

CREATE INDEX shop_staff_by_merchant_status ON shop_staff (merchant_id, status);

CREATE TABLE queue_definitions (
  queue_id TEXT PRIMARY KEY NOT NULL CHECK (length(queue_id) BETWEEN 1 AND 128),
  shop_id TEXT NOT NULL REFERENCES shops(shop_id) ON DELETE RESTRICT,
  public_slug TEXT NOT NULL UNIQUE
    CHECK (
      length(public_slug) BETWEEN 3 AND 63
      AND public_slug = lower(public_slug)
      AND public_slug NOT GLOB '*[^a-z0-9-]*'
      AND public_slug NOT GLOB '-*'
      AND public_slug NOT GLOB '*-'
    ),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  prefix TEXT NOT NULL
    CHECK (
      length(prefix) BETWEEN 1 AND 8
      AND prefix NOT GLOB '*[^A-Z0-9]*'
    ),
  start_sequence INTEGER NOT NULL
    CHECK (typeof(start_sequence) = 'integer' AND start_sequence BETWEEN 1 AND 9007199254740990),
  grace_period_seconds INTEGER NOT NULL
    CHECK (typeof(grace_period_seconds) = 'integer' AND grace_period_seconds >= 0),
  service_capacity INTEGER NOT NULL
    CHECK (typeof(service_capacity) = 'integer' AND service_capacity >= 1),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX queue_definitions_by_shop_status ON queue_definitions (shop_id, status);

-- Matches the shared contract's safe seconds-to-milliseconds calculation bound.
CREATE TABLE services (
  service_id TEXT PRIMARY KEY NOT NULL CHECK (length(service_id) BETWEEN 1 AND 128),
  shop_id TEXT NOT NULL REFERENCES shops(shop_id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  default_duration_seconds INTEGER NOT NULL
    CHECK (
      typeof(default_duration_seconds) = 'integer'
      AND default_duration_seconds BETWEEN 1 AND 9007199254740
    ),
  active INTEGER NOT NULL DEFAULT 1
    CHECK (typeof(active) = 'integer' AND active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(sort_order) = 'integer' AND sort_order >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX services_by_shop_active_sort
ON services (shop_id, active, sort_order, service_id);

CREATE TABLE display_tokens (
  display_token_id TEXT PRIMARY KEY NOT NULL CHECK (length(display_token_id) BETWEEN 1 AND 128),
  queue_id TEXT NOT NULL REFERENCES queue_definitions(queue_id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL
    CHECK (
      length(token_hash) = 64
      AND token_hash NOT GLOB '*[^a-f0-9]*'
    ),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  created_at TEXT NOT NULL,
  rotated_at TEXT
);

CREATE INDEX display_tokens_by_queue_status ON display_tokens (queue_id, status);

CREATE TABLE ticket_history (
  ticket_id TEXT PRIMARY KEY NOT NULL,
  queue_id TEXT NOT NULL REFERENCES queue_definitions(queue_id) ON DELETE RESTRICT,
  queue_session_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL
    CHECK (typeof(sequence_number) = 'integer' AND sequence_number > 0),
  display_number TEXT NOT NULL,
  service_id TEXT NOT NULL REFERENCES services(service_id) ON DELETE RESTRICT,
  joined_at TEXT NOT NULL,
  called_at TEXT,
  service_started_at TEXT,
  terminal_at TEXT NOT NULL,
  terminal_status TEXT NOT NULL
    CHECK (terminal_status IN ('COMPLETED', 'SKIPPED', 'CANCELLED', 'EXPIRED')),
  service_duration_seconds INTEGER
    CHECK (
      service_duration_seconds IS NULL
      OR (typeof(service_duration_seconds) = 'integer' AND service_duration_seconds >= 0)
    ),
  wait_duration_seconds INTEGER
    CHECK (
      wait_duration_seconds IS NULL
      OR (typeof(wait_duration_seconds) = 'integer' AND wait_duration_seconds >= 0)
    ),
  call_count INTEGER NOT NULL CHECK (typeof(call_count) = 'integer' AND call_count >= 0),
  projection_revision INTEGER NOT NULL
    CHECK (typeof(projection_revision) = 'integer' AND projection_revision >= 0),
  UNIQUE (queue_session_id, sequence_number)
);

CREATE INDEX ticket_history_by_queue_terminal
ON ticket_history (queue_id, terminal_at DESC);

CREATE INDEX ticket_history_by_session_terminal
ON ticket_history (queue_session_id, terminal_at DESC);

CREATE TABLE audit_history (
  audit_id TEXT PRIMARY KEY NOT NULL,
  queue_id TEXT NOT NULL REFERENCES queue_definitions(queue_id) ON DELETE RESTRICT,
  queue_session_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('MERCHANT', 'CUSTOMER', 'SYSTEM')),
  actor_id TEXT,
  command_type TEXT NOT NULL,
  ticket_id TEXT,
  occurred_at TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('ACCEPTED', 'REJECTED')),
  safe_metadata_json TEXT NOT NULL CHECK (json_valid(safe_metadata_json))
);

CREATE INDEX audit_history_by_queue_time ON audit_history (queue_id, occurred_at DESC);

CREATE TABLE projections_pending (
  projection_id TEXT PRIMARY KEY NOT NULL,
  projection_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision >= 0),
  attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(attempt_count) = 'integer' AND attempt_count >= 0),
  next_attempt_at TEXT NOT NULL,
  last_error_code TEXT
);

CREATE INDEX projections_pending_by_retry
ON projections_pending (next_attempt_at, projection_type);
