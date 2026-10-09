import { writable } from 'svelte/store';

export const SUCCESS_TOAST_DURATION = 5000;
export type ToastKind = 'success' | 'error';
export type PauseReason = 'hover' | 'focus';
export interface Toast {
	id: number;
	kind: ToastKind;
	message: string;
}

export function createToastManager() {
	const { subscribe, update, set } = writable<Toast[]>([]);
	const timers = new Map<number, {
		timer: ReturnType<typeof setTimeout> | undefined;
		remaining: number;
		startedAt: number;
		paused: Set<PauseReason>;
	}>();
	let nextId = 0;

	function dismiss(id: number) {
		clearTimeout(timers.get(id)?.timer);
		timers.delete(id);
		update((toasts) => toasts.filter((toast) => toast.id !== id));
	}

	function schedule(id: number) {
		const entry = timers.get(id);
		if (!entry) return;
		entry.startedAt = Date.now();
		entry.timer = setTimeout(() => dismiss(id), entry.remaining);
	}

	function publish(kind: ToastKind, message: string) {
		const id = ++nextId;
		if (kind === 'success') {
			timers.set(id, { timer: undefined, remaining: SUCCESS_TOAST_DURATION, startedAt: 0, paused: new Set() });
			schedule(id);
		}
		update((toasts) => [...toasts, { id, kind, message }]);
		return id;
	}

	function pause(id: number, reason: PauseReason) {
		const entry = timers.get(id);
		if (!entry || entry.paused.has(reason)) return;
		if (!entry.paused.size) {
			clearTimeout(entry.timer);
			entry.timer = undefined;
			entry.remaining = Math.max(0, entry.remaining - (Date.now() - entry.startedAt));
		}
		entry.paused.add(reason);
	}

	function resume(id: number, reason: PauseReason) {
		const entry = timers.get(id);
		if (!entry || !entry.paused.delete(reason) || entry.paused.size) return;
		schedule(id);
	}

	function destroy() {
		for (const entry of timers.values()) clearTimeout(entry.timer);
		timers.clear();
		set([]);
	}

	return {
		subscribe,
		success: (message: string) => publish('success', message),
		error: (message: string) => publish('error', message),
		dismiss, pause, resume, destroy
	};
}

export type ToastManager = ReturnType<typeof createToastManager>;
