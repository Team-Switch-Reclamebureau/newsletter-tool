export interface AdminUser {
	id: string;
	name: string;
	email: string;
	isAdmin: boolean;
	invitedAt: string | null;
	sentAt: string | null;
}
