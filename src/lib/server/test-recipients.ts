import type { Pool, PoolClient } from 'pg';
import type { TestRecipientsSettings } from '../test-recipients';

export async function readTestRecipients(database: Pool | PoolClient, projectId: string): Promise<TestRecipientsSettings> {
	const result = await database.query<TestRecipientsSettings>(
		'SELECT recipients, revision FROM project_test_recipients WHERE project_id = $1', [projectId]);
	return result.rows[0] ?? { recipients: [], revision: 1 };
}
