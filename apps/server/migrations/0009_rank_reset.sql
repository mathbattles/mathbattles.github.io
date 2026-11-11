-- New ranks: Arithmetic (0), Algebra (150), Geometry (200), Calculus (300), Analysis (400), Medalist (500+).
-- Everyone starts again at 100 in Arithmetic, with three placement matches that count double.
UPDATE players SET rating = 100, games = 0, season = season + 1;
