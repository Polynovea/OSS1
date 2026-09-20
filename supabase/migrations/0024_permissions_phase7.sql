-- Phase 7 — Information Architecture & Media Operations Permissions.
--
-- Adds dedicated permission keys for Taxonomy, Routing, Redirects, and Navigation.
-- Keeps existing media.* permissions intact.

insert into permissions (key, description) values
  ('taxonomy.read', 'View taxonomies, terms, and term assignments'),
  ('taxonomy.manage', 'Create, edit, merge, and deprecate taxonomies and terms'),
  ('routing.read', 'View site tree, route registry, and path history'),
  ('routing.manage', 'Register, update, and reorganize site routes'),
  ('redirect.read', 'View redirect rules and hit analytics'),
  ('redirect.manage', 'Create, update, and import redirects'),
  ('navigation.read', 'View navigation menus and item structures'),
  ('navigation.manage', 'Create, edit, and publish navigation menu versions')
on conflict (key) do nothing;
