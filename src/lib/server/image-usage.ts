import type { PoolClient } from 'pg';
import { imageAssetPath } from '../remote';

export async function imageInUse(client: PoolClient, assetId: string): Promise<boolean> {
	const usage = await client.query<{ in_use: boolean }>(`
		SELECT EXISTS (
			SELECT 1 FROM newsletters WHERE deleted_at IS NULL AND position($1 in content::text) > 0
		) OR EXISTS (
			SELECT 1 FROM projects WHERE position($1 in template) > 0 OR position($1 in coalesce(item_template, '')) > 0
		) AS in_use`, [imageAssetPath(assetId)]);
	return usage.rows[0].in_use;
}
