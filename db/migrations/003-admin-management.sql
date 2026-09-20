ALTER TABLE guests
  ADD COLUMN companions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(companions) = 'array'),
  ADD COLUMN admin_revision integer NOT NULL DEFAULT 0;
-- statement-breakpoint
ALTER TABLE rsvps ADD COLUMN response_source text NOT NULL DEFAULT 'guest' CHECK (response_source IN ('guest','admin'));
-- statement-breakpoint
CREATE TABLE admin_invitation_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guest_id integer NOT NULL REFERENCES guests(id) ON DELETE RESTRICT,
  actor_id text NOT NULL CHECK (actor_id ~ '^[0-9]+$'),
  changed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL
);
-- statement-breakpoint
CREATE FUNCTION admin_update_invitation(
  target_id integer, desired_decision text, desired_companions jsonb,
  expected_version text, actor text
) RETURNS void LANGUAGE plpgsql AS $admin_update$
DECLARE
  invitation guests%ROWTYPE;
  response rsvps%ROWTYPE;
  current_version text;
  original_seats integer;
  added_seats integer;
  reserved_companions integer;
  before_data jsonb;
  after_data jsonb;
BEGIN
  IF actor IS NULL OR actor !~ '^[0-9]+$' THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='ADMIN_INVALID';
  END IF;
  SELECT * INTO invitation FROM guests WHERE id=target_id AND active AND NOT is_test FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='ADMIN_NOT_FOUND'; END IF;
  SELECT * INTO response FROM rsvps WHERE guest_id=target_id;
  current_version := md5(jsonb_build_array(invitation.admin_revision,response.decision,response.message,extract(epoch FROM response.submitted_at))::text);
  IF expected_version IS NULL OR current_version<>expected_version THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='ADMIN_CONFLICT';
  END IF;
  IF (desired_decision IS NOT NULL AND desired_decision NOT IN ('attending','declined'))
     OR (desired_decision IS NULL AND response.decision IS NOT NULL)
     OR desired_companions IS NULL OR jsonb_typeof(desired_companions)<>'array' THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='ADMIN_INVALID';
  END IF;
  IF jsonb_array_length(desired_companions)>20 THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='ADMIN_INVALID';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(desired_companions) c
    WHERE jsonb_typeof(c)<>'object' OR jsonb_typeof(c->'name') IS DISTINCT FROM 'string'
      OR char_length(trim(c->>'name')) NOT BETWEEN 1 AND 120
      OR jsonb_typeof(c->'additionalSeat') IS DISTINCT FROM 'boolean') THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='ADMIN_INVALID';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(desired_companions) c
    GROUP BY lower(trim(c->>'name')) HAVING count(*)>1) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='ADMIN_INVALID';
  END IF;
  SELECT invitation.seat_count-count(*)::integer INTO original_seats
    FROM jsonb_array_elements(invitation.companions) c WHERE (c->>'additionalSeat')::boolean;
  SELECT count(*) FILTER(WHERE (c->>'additionalSeat')::boolean),
         count(*) FILTER(WHERE NOT (c->>'additionalSeat')::boolean)
    INTO added_seats,reserved_companions FROM jsonb_array_elements(desired_companions) c;
  IF original_seats<1 OR reserved_companions>original_seats-1 THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='ADMIN_SEATS';
  END IF;
  IF invitation.companions=desired_companions AND response.decision IS NOT DISTINCT FROM desired_decision THEN
    RETURN;
  END IF;
  before_data := jsonb_build_object('seatCount',invitation.seat_count,'companions',invitation.companions,'response',to_jsonb(response));
  UPDATE guests SET companions=desired_companions,seat_count=original_seats+added_seats,
    admin_revision=admin_revision+1 WHERE id=target_id;
  IF desired_decision IS DISTINCT FROM response.decision THEN
    INSERT INTO rsvps(guest_id,decision,message,response_source)
    VALUES(target_id,desired_decision,'','admin')
    ON CONFLICT(guest_id) DO UPDATE SET decision=EXCLUDED.decision,
      submitted_at=CURRENT_TIMESTAMP,response_source='admin';
  END IF;
  SELECT * INTO response FROM rsvps WHERE guest_id=target_id;
  after_data := jsonb_build_object('seatCount',original_seats+added_seats,'companions',desired_companions,'response',to_jsonb(response));
  INSERT INTO admin_invitation_changes(guest_id,actor_id,before_state,after_state)
    VALUES(target_id,actor,before_data,after_data);
END;
$admin_update$;
