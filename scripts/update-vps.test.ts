import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const fixtures: string[] = [];

function runUpdate(options: { tag?: string; dirty?: boolean; divergent?: boolean; failure?: string; unhealthy?: boolean; sudo?: boolean } = {}) {
	const root = mkdtempSync(join(tmpdir(), 'postroom-update-test-'));
	fixtures.push(root);
	const repo = join(root, 'repo');
	const bin = join(root, 'bin');
	const backups = join(root, 'backups');
	mkdirSync(join(repo, 'scripts'), { recursive: true });
	mkdirSync(bin);
	mkdirSync(join(root, 'images'));
	copyFileSync(new URL('./update-vps.sh', import.meta.url), join(repo, 'scripts/update-vps.sh'));
	for (const file of ['.env', 'compose.yaml', 'compose.vps.yaml']) writeFileSync(join(repo, file), 'fixture');
	writeFileSync(join(bin, 'git'), `#!/usr/bin/env bash
echo "git $*" >> "$TEST_LOG"
case "$1" in
  status) if [[ "$TEST_DIRTY" == 1 ]]; then echo ' M compose.yaml'; fi ;;
  rev-parse) echo abc123 ;;
  merge-base) if [[ "$TEST_DIVERGENT" == 1 ]]; then exit 1; fi ;;
esac
`, { mode: 0o755 });
	writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash
echo "docker $*" >> "$TEST_LOG"
if [[ "$1" == info && "$TEST_SUDO" == 1 && "\${VIA_SUDO:-}" != 1 ]]; then exit 1; fi
if [[ "$1" == inspect ]]; then
  if [[ "$TEST_UNHEALTHY" == 1 ]]; then echo 'running unhealthy'; else echo 'running healthy'; fi
fi
if [[ -n "$TEST_FAILURE" && "$*" == *"$TEST_FAILURE"* ]]; then exit 1; fi
case "$*" in
  *pg_dump*) echo database-backup ;;
  *pg_restore*) cat >/dev/null ;;
  *'tar -C /data/uploads'*) tar -C "$TEST_IMAGES" -czf - . ;;
  *'ps -q app'*) echo app-container ;;
esac
`, { mode: 0o755 });
	writeFileSync(join(bin, 'sudo'), `#!/usr/bin/env bash
echo "sudo $*" >> "$TEST_LOG"
if [[ "$1" == -v ]]; then exit 0; fi
VIA_SUDO=1 "$@"
`, { mode: 0o755 });
	const result = spawnSync('bash', [join(repo, 'scripts/update-vps.sh'), ...(options.tag ? [options.tag] : [])], {
		encoding: 'utf8',
		env: {
			...process.env,
			PATH: `${bin}:${process.env.PATH}`,
			POSTROOM_ENV_FILE: '.env',
			POSTROOM_BACKUP_DIR: backups,
			TEST_LOG: join(root, 'commands.log'),
			TEST_IMAGES: join(root, 'images'),
			TEST_DIRTY: options.dirty ? '1' : '0',
			TEST_DIVERGENT: options.divergent ? '1' : '0',
			TEST_FAILURE: options.failure ?? '',
			TEST_UNHEALTHY: options.unhealthy ? '1' : '0',
			TEST_SUDO: options.sudo ? '1' : '0'
		}
	});
	return { result, backups, commands: readFileSync(join(root, 'commands.log'), 'utf8') };
}

afterEach(() => {
	for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('VPS updater', () => {
	it('backs up before updating main, checks health, and removes the lock', () => {
		const { result, backups, commands } = runUpdate();
		expect(result.status, result.stderr).toBe(0);
		expect(commands.indexOf('stop app')).toBeLessThan(commands.indexOf('pg_dump'));
		expect(commands.indexOf('pg_dump')).toBeLessThan(commands.indexOf('git switch main'));
		expect(commands).toContain('exec -T --interactive=false db pg_dump --no-password --lock-wait-timeout=30s');
		expect(commands).toContain('run --rm -T --interactive=false --no-deps --entrypoint sh app');
		expect(result.stdout).toContain('Backing up PostgreSQL...');
		expect(result.stdout).toContain('Backing up uploaded images...');
		expect(result.stdout).toContain('Checking backup archives...');
		expect(commands).toContain('git merge --ff-only refs/remotes/origin/main');
		expect(commands).toContain('up -d --build db migrate app');
		expect(commands).toContain("fetch('http://127.0.0.1:3000/healthz')");
		const directories = readdirSync(backups);
		expect(directories).toHaveLength(1);
		expect(readdirSync(join(backups, directories[0]))).toEqual([
			'compose.vps.yaml', 'compose.yaml', 'database.dump', 'deployment.env', 'images.tgz', 'previous-commit.txt'
		]);
	});

	it('can deploy a release and uses sudo only for Docker', () => {
		const { result, commands } = runUpdate({ tag: 'v1.2.3', sudo: true });
		expect(result.status, result.stderr).toBe(0);
		expect(commands).toContain('git switch --detach refs/tags/v1.2.3');
		expect(commands).toContain('sudo docker compose');
		expect(commands).not.toContain('sudo git');
	});

	it.each([{ dirty: true }, { divergent: true }])('rejects unsafe source updates before stopping the app: %s', (options) => {
		const { result, commands } = runUpdate(options);
		expect(result.status).not.toBe(0);
		expect(commands).not.toContain('stop app');
	});

	it('does not update code when the database backup fails', () => {
		const { result, commands, backups } = runUpdate({ failure: 'pg_dump' });
		expect(result.status).not.toBe(0);
		expect(commands).not.toContain('git switch');
		expect(commands).not.toContain('up -d');
		expect(result.stderr).toContain('No automatic rollback');
		expect(readdirSync(backups)).not.toContain('.update-lock');
	});

	it('reports an unhealthy deployment instead of claiming success', () => {
		const { result, commands, backups } = runUpdate({ unhealthy: true });
		expect(result.status).not.toBe(0);
		expect(result.stdout).not.toContain('Update complete');
		expect(commands).toContain('logs --tail=100 migrate app');
		expect(readdirSync(backups)).not.toContain('.update-lock');
	});
});
