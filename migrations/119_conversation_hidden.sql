-- 118 : suppression d'une discussion « pour moi » (masquage par participant)
-- Non destructif : aucune conversation ni aucun message n'est supprimé de la base.
-- hidden_at = date à laquelle ce participant a supprimé la discussion de sa liste.
-- La discussion réapparaît pour lui uniquement lorsqu'un nouveau message arrive après cette date ;
-- il ne voit alors que les messages postérieurs à hidden_at.
ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;

COMMENT ON COLUMN conversation_members.hidden_at IS 'Suppression de la discussion pour ce participant (masquage personnel, les autres participants ne sont pas affectés).';
