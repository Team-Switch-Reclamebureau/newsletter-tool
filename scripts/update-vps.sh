#!/usr/bin/env bash
set -Eeuo pipefail

main() {
  if [[ $# -gt 1 || ${1:-} == -* ]]; then
    echo "Usage: bash scripts/update-vps.sh [release-tag]" >&2
    return 1
  fi

  local repo target previous backup lock app_id state attempt
  local env_file="${POSTROOM_ENV_FILE:-.env}"
  local backup_root="${POSTROOM_BACKUP_DIR:-$HOME/backups/postroom}"
  local -a docker_command=(docker) compose
  repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  cd "$repo"

  if [[ ! -f "$env_file" ]]; then
    echo "Missing environment file: $env_file. Set POSTROOM_ENV_FILE if needed." >&2
    return 1
  fi
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "The repository has local changes. Commit or move them before updating." >&2
    return 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "Docker access requires sudo."
    sudo -v
    docker_command=(sudo docker)
    "${docker_command[@]}" info >/dev/null
  fi
  compose=("${docker_command[@]}" compose --env-file "$env_file" -p postroom
    -f compose.yaml -f compose.vps.yaml)
  "${compose[@]}" config --quiet

  git fetch --tags origin
  if [[ $# -eq 1 ]]; then
    target="refs/tags/$1"
    git rev-parse --verify "$target^{commit}" >/dev/null
  else
    target=refs/remotes/origin/main
    git rev-parse --verify "$target^{commit}" >/dev/null
  fi
  previous="$(git rev-parse HEAD)"
  if ! git merge-base --is-ancestor "$previous" "$target"; then
    echo "Refusing a downgrade or divergent update: $target does not contain the current commit." >&2
    return 1
  fi
  git cat-file -e "$target:compose.vps.yaml"

  umask 077
  mkdir -p "$backup_root"
  backup_root="$(cd "$backup_root" && pwd)"
  case "$backup_root/" in
    "$repo/"*)
      echo "POSTROOM_BACKUP_DIR must be outside the repository." >&2
      return 1
      ;;
  esac
  lock="$backup_root/.update-lock"
  if ! mkdir "$lock"; then
    echo "Another update may be running. Check $lock before retrying." >&2
    return 1
  fi
  trap "rmdir -- $(printf '%q' "$lock")" EXIT
  trap 'echo "Update failed. Backup directory: ${backup:-not created}. The app may be stopped; inspect logs before restarting. No automatic rollback was attempted." >&2' ERR

  backup="$(mktemp -d "$backup_root/$(date +%Y%m%d-%H%M%S)-XXXXXX")"
  printf '%s\n' "$previous" > "$backup/previous-commit.txt"
  cp "$env_file" "$backup/deployment.env"
  cp compose.yaml compose.vps.yaml "$backup/"

  echo "Stopping the app for consistent database/image backups. Other services are unaffected."
  echo "Backups: $backup"
  "${compose[@]}" stop app
  "${compose[@]}" exec -T db pg_dump -U postroom_owner -d postroom -Fc > "$backup/database.dump"
  "${compose[@]}" run --rm -T --no-deps --entrypoint sh app \
    -c 'tar -C /data/uploads -czf - .' > "$backup/images.tgz"
  [[ -s "$backup/database.dump" && -s "$backup/images.tgz" ]]
  "${compose[@]}" exec -T db pg_restore --list < "$backup/database.dump" >/dev/null
  tar -tzf "$backup/images.tgz" >/dev/null

  if [[ $# -eq 1 ]]; then
    git switch --detach "$target"
  else
    git switch main
    git merge --ff-only "$target"
  fi
  "${compose[@]}" config --quiet
  "${compose[@]}" up -d --build db migrate app
  app_id="$("${compose[@]}" ps -q app)"
  [[ -n "$app_id" ]]
  for ((attempt = 0; attempt < 60; attempt++)); do
    state="$("${docker_command[@]}" inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$app_id")"
    case "$state" in
      "running healthy")
        "${compose[@]}" exec -T app node -e \
          "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(e=>{console.error(e);process.exit(1)})"
        echo "Update complete: $(git rev-parse --short HEAD)"
        echo "Backups retained at $backup. Copy them off the VPS; deployment.env contains secrets."
        return 0
        ;;
      exited*|dead*|"running unhealthy")
        break
        ;;
    esac
    sleep 2
  done
  "${compose[@]}" logs --tail=100 migrate app >&2
  echo "The app did not become healthy within 120 seconds." >&2
  return 1
}

main "$@"
