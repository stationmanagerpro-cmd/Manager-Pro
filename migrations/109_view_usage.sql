-- Écrans les plus utilisés : minutes d'utilisation cumulées par écran et par jour (toutes stations confondues).
CREATE TABLE IF NOT EXISTS view_usage (
  day     DATE NOT NULL DEFAULT CURRENT_DATE,
  view    TEXT NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, view)
);
