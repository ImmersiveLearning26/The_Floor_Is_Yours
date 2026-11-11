// Runs the Lovable Cloud migration on a real Postgres engine (PGlite) with minimal stand-ins for the
// auth.users and storage.buckets tables that Lovable Cloud provides, then checks the database-level rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'supabase', 'migrations');
const sql = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
const U = '11111111-1111-1111-1111-111111111111';

async function db() {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated;
    create schema auth; create table auth.users (id uuid primary key);
    create schema storage; create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);`);
  await pg.exec(sql);
  await pg.query('insert into auth.users (id) values ($1)', [U]);
  return pg;
}
const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code);

test('migration applies twice (idempotent) and creates the learner on sign-up', async () => {
  const pg = await db();
  await pg.exec(sql);
  assert.equal((await pg.query<{ n: number }>('select count(*)::int n from public.learners where id = $1', [U])).rows[0].n, 1);
  assert.deepEqual((await pg.query('select id, public from storage.buckets')).rows, [{ id: 'fiy-private', public: false }]);
});

test('one unfinished run per learner and one recording per run, enforced by the database', async () => {
  const pg = await db();
  await pg.query(`insert into public.runs (id, learner_id, status, doc) values ('r1', $1, 'active', '{}')`, [U]);
  assert.equal(await code(pg.query(`insert into public.runs (id, learner_id, status, doc) values ('r2', $1, 'submitted', '{}')`, [U])), '23505');
  await pg.query(`update public.runs set status = 'closed-unscored' where id = 'r1'`);
  assert.equal(await code(pg.query(`insert into public.runs (id, learner_id, status, doc) values ('r2', $1, 'active', '{}')`, [U])), 'ok');
  await pg.query(`insert into public.recordings (id, run_id, learner_id, doc) values ('a', 'r2', $1, '{}')`, [U]);
  assert.equal(await code(pg.query(`insert into public.recordings (id, run_id, learner_id, doc) values ('b', 'r2', $1, '{}')`, [U])), '23505');
});

test('claim_job hands the processing lease to one caller at a time', async () => {
  const pg = await db();
  await pg.query(`insert into public.runs (id, learner_id, status, doc) values ('r1', $1, 'submitted', '{}')`, [U]);
  await pg.query(`insert into public.jobs (id, run_id, learner_id, stage, doc) values ('j1', 'r1', $1, 'queued', '{}')`, [U]);
  const claim = async (until: string, now: string) => (await pg.query<{ ok: boolean }>(`select public.claim_job('j1', $1, $2) ok`, [until, now])).rows[0].ok;
  assert.equal(await claim('2026-01-01T10:03:00Z', '2026-01-01T10:00:00Z'), true);
  assert.equal(await claim('2026-01-01T10:04:00Z', '2026-01-01T10:01:00Z'), false);
  assert.equal(await claim('2026-01-01T10:09:00Z', '2026-01-01T10:05:00Z'), true);
});

test('browser roles cannot read or write any table, or call the lease function', async () => {
  const pg = await db();
  await pg.exec('set role anon');
  for (const t of ['learners', 'runs', 'recordings', 'jobs', 'evaluations', 'reviews', 'audit_log']) assert.equal(await code(pg.query(`select * from public.${t}`)), '42501', t);
  assert.equal(await code(pg.query(`select public.claim_job('j1', now(), now())`)), '42501');
  await pg.exec('reset role; set role authenticated');
  assert.equal(await code(pg.query(`insert into public.runs (id, learner_id, status, doc) values ('x', '${U}', 'active', '{}')`)), '42501');
});
