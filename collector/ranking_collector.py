#!/usr/bin/env python3
"""Independent hourly collector. Reads World Compass without modifying its files."""
import argparse
import contextlib
import datetime as dt
import email.utils
try:
    import fcntl
except ImportError:
    fcntl = None
import http.cookiejar
import json
import os
from pathlib import Path
import random
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = 'https://api.vrchat.cloud/api/1/'
WORLD_ID = re.compile(r'^wrld_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)
KANA = re.compile(r'[\u3041-\u3096\u30a1-\u30fa\uff66-\uff9d]')
SCHEMA = '''
CREATE TABLE IF NOT EXISTS observations (
 hour INTEGER NOT NULL, world_id TEXT NOT NULL, observed_at TEXT NOT NULL,
 total INTEGER NOT NULL, public INTEGER NOT NULL, private INTEGER NOT NULL,
 metadata TEXT NOT NULL, PRIMARY KEY(hour,world_id)
);
CREATE INDEX IF NOT EXISTS observations_world_hour ON observations(world_id,hour);
CREATE TABLE IF NOT EXISTS runs (
 hour INTEGER PRIMARY KEY, observed_at TEXT NOT NULL,
 candidate_count INTEGER NOT NULL, eligible_count INTEGER NOT NULL, failed_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS candidate_cache (
 world_id TEXT PRIMARY KEY, eligible INTEGER NOT NULL, checked_at INTEGER NOT NULL
);
'''


def iso(timestamp=None):
    return dt.datetime.fromtimestamp(timestamp if timestamp is not None else time.time(), dt.timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def japanese(world, overrides=None):
    overrides = overrides or {}
    identifier = world.get('worldId', world.get('id'))
    if identifier in overrides.get('exclude', []):
        return False
    if identifier in overrides.get('include', []):
        return True
    tags = world.get('tags') or []
    tags = [tag for tag in tags if isinstance(tag, str)]
    text = ' '.join([str(world.get('name') or ''), str(world.get('description') or ''), ' '.join(tags)]).lower()
    if KANA.search(text):
        return True
    plain_tags = {tag.lower().removeprefix('author_tag_') for tag in tags}
    return bool(plain_tags & {'jp', 'jpn', 'japan', 'japanese'}) or bool(re.search(r'日本|japan(?:ese)?|\bjpn\b|\bjp\b', text))


def valid_counts(raw):
    return all(type(raw.get(key)) is int and 0 <= raw[key] <= 10_000_000
               for key in ('occupants', 'publicOccupants', 'privateOccupants'))


def metadata(raw, existing=None):
    existing = existing or {}
    raw_platforms = raw.get('unityPackages')
    platforms = sorted({{'standalonewindows': 'pc', 'android': 'quest', 'ios': 'ios'}[p['platform']]
                        for p in raw_platforms or [] if isinstance(p, dict) and p.get('platform') in ('standalonewindows', 'android', 'ios')})
    if not platforms:
        platforms = existing.get('platforms') or []
    thumbnail = raw.get('thumbnailImageUrl') or raw.get('imageUrl')
    if not isinstance(thumbnail, str) or not re.fullmatch(r'https://api\.vrchat\.cloud/api/1/(file|image)/[a-zA-Z0-9_\-/]+', thumbnail):
        thumbnail = None
    name = raw.get('name')
    if not isinstance(name, str) or not 1 <= len(name) <= 200:
        raise ValueError('Invalid world name')
    return {'id': raw['id'], 'name': name, 'author': str(raw.get('authorName') or existing.get('author') or '')[:200],
            'platforms': platforms, 'thumbnail': thumbnail}


class AuthenticationRequired(RuntimeError):
    pass


class ServiceUnavailable(RuntimeError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Api:
    def __init__(self, cookie_file, contact, interval=4, state_file=None):
        if not isinstance(contact, str) or not contact or any(c.isspace() for c in contact):
            raise ValueError('Developer contact required')
        cookie_file = Path(cookie_file)
        if cookie_file.stat().st_mode & 0o077:
            raise ValueError('Authentication file permissions must be 600')
        jar = http.cookiejar.MozillaCookieJar(str(cookie_file))
        jar.load(ignore_discard=True, ignore_expires=False)
        # The existing cookie file is only read. Updated cookies stay in this process.
        self.opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPCookieProcessor(jar))
        self.user_agent = 'WorldWatchRanking/1.0.0 ' + contact
        self.interval = max(4, interval)
        self.next_request = 0
        self.state_file = Path(state_file) if state_file else None
        if self.state_file and self.state_file.exists():
            next_allowed = json.loads(self.state_file.read_text()).get('nextAllowedAt', 0)
            self.next_request = time.monotonic() + max(0, float(next_allowed) - time.time())

    def defer(self, seconds):
        self.next_request = time.monotonic() + seconds
        if self.state_file:
            export(self.state_file, {'nextAllowedAt': time.time() + seconds})

    def get(self, path):
        if path.startswith(('/', 'http')) or '..' in path:
            raise ValueError('Invalid API path')
        for attempt in range(3):
            time.sleep(max(0, self.next_request - time.monotonic()))
            self.defer(self.interval + random.uniform(0, 1))
            request = urllib.request.Request(BASE + path, headers={'User-Agent': self.user_agent, 'Accept': 'application/json'})
            try:
                with self.opener.open(request, timeout=25) as response:
                    raw = response.read(4 * 1024 * 1024 + 1)
                if len(raw) > 4 * 1024 * 1024:
                    raise RuntimeError('API response too large')
                return json.loads(raw)
            except urllib.error.HTTPError as error:
                if error.code in (401, 403):
                    raise AuthenticationRequired('VRChat authentication needs attention') from None
                if error.code != 429 and error.code < 500:
                    raise RuntimeError('API HTTP ' + str(error.code)) from None
                wait = 30 * 2 ** attempt
                retry = error.headers.get('Retry-After')
                if retry:
                    try:
                        wait = max(wait, float(retry))
                    except ValueError:
                        with contextlib.suppress(ValueError, TypeError):
                            wait = max(wait, email.utils.parsedate_to_datetime(retry).timestamp() - time.time())
                self.defer(max(30, wait))
                if attempt == 2:
                    raise ServiceUnavailable('API retry limit reached') from None
            except (urllib.error.URLError, TimeoutError):
                self.defer(30 * 2 ** attempt)
                if attempt == 2:
                    raise ServiceUnavailable('API unavailable') from None


def candidates(api, limit=500):
    if not 1 <= limit <= 500:
        raise ValueError('Candidate limit must be between 1 and 500')
    result, seen = [], set()
    for offset in range(0, limit, 100):
        requested = min(100, limit - offset)
        query = urllib.parse.urlencode({'n': requested, 'offset': offset, 'sort': 'popularity', 'order': 'descending', 'releaseStatus': 'public'})
        rows = api.get('worlds/active?' + query)
        if not isinstance(rows, list):
            raise RuntimeError('Invalid active-world response')
        for row in rows:
            if not isinstance(row, dict):
                continue
            identifier = row.get('id')
            if isinstance(identifier, str) and WORLD_ID.fullmatch(identifier) and identifier not in seen:
                seen.add(identifier)
                result.append(row)
        if len(rows) < requested:
            break
    return result[:limit]


def open_source(path):
    connection = sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True, timeout=5)
    connection.execute('PRAGMA query_only=ON')
    return connection


def observe(api, source, overrides, pool, cache=None, progress=None):
    worlds, eligible, failed = [], 0, 0
    for index, candidate in enumerate(pool):
        if progress and index % 25 == 0:
            progress(index, len(pool), len(worlds), failed)
        identifier = candidate['id']
        row = source.execute('SELECT record FROM worlds WHERE id=?', (identifier,)).fetchone()
        existing = json.loads(row[0]) if row else None
        # Active metadata can carry a newly added Japanese marker too.
        if identifier in overrides.get('exclude', []):
            continue
        if existing is not None and not japanese(existing, overrides) and not japanese(candidate, overrides):
            continue
        if cache is not None and existing is None and not japanese(candidate, overrides):
            cached = cache.execute('SELECT eligible,checked_at FROM candidate_cache WHERE world_id=?', (identifier,)).fetchone()
            if cached and not cached[0] and cached[1] > time.time() - 86400:
                continue
        eligible += 1
        try:
            raw = api.get('worlds/' + identifier)
            if not isinstance(raw, dict) or raw.get('id') != identifier:
                raise ValueError('World identity mismatch')
            if raw.get('releaseStatus') != 'public' or not japanese(raw, overrides):
                if cache is not None:
                    with cache:
                        cache.execute('INSERT OR REPLACE INTO candidate_cache VALUES(?,?,?)', (identifier, 0, int(time.time())))
                eligible -= 1
                continue
            if not valid_counts(raw):
                raise ValueError('Missing or invalid population fields')
            item = metadata(raw, existing)
            item.update(total=raw['occupants'], public=raw['publicOccupants'], private=raw['privateOccupants'], observedAt=iso())
            worlds.append(item)
        except (AuthenticationRequired, ServiceUnavailable):
            raise
        except (RuntimeError, ValueError, TypeError, KeyError):
            failed += 1
    if progress:
        progress(len(pool), len(pool), len(worlds), failed)
    return worlds, eligible, failed


def persist(connection, hour, worlds, candidate_count, eligible, failed, observed_at):
    with connection:
        connection.execute('DELETE FROM observations WHERE hour=?', (hour,))
        for world in worlds:
            public_metadata = {k: world[k] for k in ('id', 'name', 'author', 'platforms', 'thumbnail')}
            connection.execute('INSERT OR REPLACE INTO observations VALUES(?,?,?,?,?,?,?)',
                               (hour, world['id'], world['observedAt'], world['total'], world['public'], world['private'], json.dumps(public_metadata, ensure_ascii=False)))
        connection.execute('INSERT OR REPLACE INTO runs VALUES(?,?,?,?,?)', (hour, observed_at, candidate_count, eligible, failed))
        connection.execute('DELETE FROM observations WHERE hour<?', (hour - 30 * 86400,))
        connection.execute('DELETE FROM runs WHERE hour<?', (hour - 30 * 86400,))


def build_snapshot(connection, hour):
    row = connection.execute('SELECT observed_at,candidate_count,eligible_count,failed_count FROM runs WHERE hour=?', (hour,)).fetchone()
    if not row:
        raise ValueError('Run not found')
    worlds = []
    for identifier, observed_at, total, public, private, raw in connection.execute('SELECT world_id,observed_at,total,public,private,metadata FROM observations WHERE hour=? ORDER BY total DESC,world_id', (hour,)):
        world = json.loads(raw)
        history = [list(p) for p in connection.execute("SELECT CAST(strftime('%s',observed_at) AS INTEGER),total,public,private FROM observations WHERE world_id=? AND hour>=? AND hour<=? ORDER BY hour", (identifier, hour - 47 * 3600, hour))]
        previous = connection.execute('SELECT total,public FROM observations WHERE world_id=? AND hour=?', (identifier, hour - 3600)).fetchone()
        world.update(total=total, public=public, private=private, observedAt=observed_at, history=history,
                     deltaTotal=total-previous[0] if previous else None, deltaPublic=public-previous[1] if previous else None)
        worlds.append(world)
    return {'version': 1, 'demo': False, 'hour': iso(hour), 'observedAt': row[0], 'candidateCount': row[1], 'eligibleCount': row[2], 'failedCount': row[3], 'worlds': worlds}


def export(path, payload):
    path = Path(path)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    temp.replace(path)


def upload(url, token_file, payload):
    if not url.startswith('https://') or urllib.parse.urlsplit(url).path != '/api/ingest':
        raise ValueError('HTTPS ingest URL required')
    token = Path(token_file).read_text().strip()
    if len(token) < 32:
        raise ValueError('Ingest token too short')
    body = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode()
    request = urllib.request.Request(url, data=body, headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'User-Agent': 'VRC-Ranking-Board/1.0 (+https://github.com/yuhi-neru/vrc-ranking-board)'}, method='POST')
    opener = urllib.request.build_opener(NoRedirect())
    with opener.open(request, timeout=30) as response:
        if response.status != 200:
            raise RuntimeError('Upload failed')


def run(config):
    if fcntl is None:
        raise RuntimeError('Collector requires Linux')
    directory = Path(config['dataDir'])
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / 'ranking.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Another ranking run is active') from None
        hour = int(time.time()) // 3600 * 3600
        overrides_path = Path(config.get('overridesFile', directory / 'overrides.json'))
        overrides = json.loads(overrides_path.read_text()) if overrides_path.exists() else {}
        contact = config.get('contact')
        if not contact and config.get('sourceConfig'):
            contact = json.loads(Path(config['sourceConfig']).read_text()).get('contact')
        api = Api(config['cookieFile'], contact, config.get('intervalSeconds', 4), directory / 'api-state.json')
        user = api.get('auth/user')
        if not isinstance(user, dict) or not isinstance(user.get('id'), str) or not user['id'].startswith('usr_') or user.get('requiresTwoFactorAuth'):
            raise AuthenticationRequired('VRChat authentication needs attention')
        pool = candidates(api, config.get('candidateLimit', 500))
        if not pool:
            raise ServiceUnavailable('Empty active list; previous ranking retained')
        def progress(checked, candidate_count, world_count, failure_count):
            export(directory / 'status.json', {'state': 'collecting', 'updatedAt': iso(), 'checked': checked, 'candidateCount': candidate_count, 'worldCount': world_count, 'failedCount': failure_count})
        with contextlib.closing(sqlite3.connect(directory / 'ranking.sqlite')) as connection:
            connection.executescript(SCHEMA)
            with contextlib.closing(open_source(config['sourceDb'])) as source:
                worlds, eligible, failed = observe(api, source, overrides, pool, cache=connection, progress=progress)
            if eligible and not worlds and failed:
                raise RuntimeError('No valid observations; previous ranking retained')
            persist(connection, hour, worlds, len(pool), eligible, failed, iso())
            payload = build_snapshot(connection, hour)
        export(directory / 'latest.json', payload)
        if config.get('ingestUrl'):
            upload(config['ingestUrl'], config['ingestTokenFile'], payload)
        export(directory / 'status.json', {'state': 'complete', 'updatedAt': iso(), 'candidateCount': len(pool), 'worldCount': len(worlds), 'failedCount': failed, 'uploaded': bool(config.get('ingestUrl'))})
        print(json.dumps({'candidateCount': len(pool), 'worldCount': len(worlds), 'failedCount': failed, 'uploaded': bool(config.get('ingestUrl'))}))


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=Path, required=True)
    args = parser.parse_args()
    try:
        config = json.loads(args.config.read_text())
        run(config)
        return 0
    except Exception as error:
        # Never log response bodies, cookies, config contents or request headers.
        code = 'auth-required' if isinstance(error, AuthenticationRequired) else 'error'
        if 'config' in locals() and 'dataDir' in config:
            directory = Path(config['dataDir'])
            if directory.exists():
                export(directory / 'status.json', {'state': code, 'updatedAt': iso()})
        print('Ranking collection failed: ' + code, file=sys.stderr)
        return 20 if code == 'auth-required' else 1


if __name__ == '__main__':
    sys.exit(main())
