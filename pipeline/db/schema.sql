CREATE TABLE IF NOT EXISTS collection_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  run_type TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  message TEXT
);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  source_listing_id TEXT NOT NULL,
  listing_url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  price REAL NOT NULL,
  shipping_price REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  condition TEXT,
  seller_name TEXT,
  seller_feedback_score INTEGER,
  seller_feedback_percent REAL,
  location TEXT,
  category TEXT,
  image_urls TEXT NOT NULL DEFAULT '[]',
  listed_at TEXT,
  scraped_at TEXT NOT NULL,
  listing_status TEXT NOT NULL,
  excluded INTEGER NOT NULL DEFAULT 0,
  excluded_reason TEXT,
  raw_payload TEXT NOT NULL,
  UNIQUE(source, source_listing_id)
);

CREATE TABLE IF NOT EXISTS sold_comps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  sold_item_id TEXT NOT NULL,
  sold_url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  sold_price REAL NOT NULL,
  shipping_price REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  condition TEXT,
  sold_date TEXT,
  image_urls TEXT NOT NULL DEFAULT '[]',
  raw_payload TEXT NOT NULL,
  UNIQUE(source, sold_item_id)
);

CREATE TABLE IF NOT EXISTS item_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  source_item_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  brand TEXT,
  lens_model TEXT,
  mount TEXT,
  focal_length TEXT,
  aperture TEXT,
  stabilization INTEGER,
  autofocus INTEGER,
  version TEXT,
  condition_grade TEXT,
  included_accessories TEXT NOT NULL DEFAULT '[]',
  box_included INTEGER NOT NULL DEFAULT 0,
  caps_included INTEGER NOT NULL DEFAULT 0,
  hood_included INTEGER NOT NULL DEFAULT 0,
  damage_flags TEXT NOT NULL DEFAULT '[]',
  risk_flags TEXT NOT NULL DEFAULT '[]',
  confidence TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(source, source_item_id, item_type, content_hash)
);

CREATE TABLE IF NOT EXISTS opportunity_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_listing_id TEXT NOT NULL,
  market_value REAL NOT NULL,
  low_value REAL NOT NULL,
  high_value REAL NOT NULL,
  comp_count INTEGER NOT NULL,
  confidence TEXT NOT NULL,
  expected_profit REAL NOT NULL,
  roi_percent REAL NOT NULL,
  buy_score INTEGER NOT NULL,
  decision TEXT NOT NULL,
  warnings TEXT NOT NULL DEFAULT '[]',
  scored_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sales_trends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  search_term TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  sold_count INTEGER NOT NULL,
  median_sold_price REAL NOT NULL,
  average_sold_price REAL NOT NULL,
  low_sold_price REAL NOT NULL,
  high_sold_price REAL NOT NULL,
  price_momentum_percent REAL NOT NULL,
  sell_through_proxy REAL NOT NULL,
  confidence TEXT NOT NULL,
  calculated_at TEXT NOT NULL,
  UNIQUE(search_term, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS ai_extractions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  source_item_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  output_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(source, source_item_id, content_hash, model, prompt_version)
);
