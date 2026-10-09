import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToastManager, SUCCESS_TOAST_DURATION, type Toast } from './toasts';

describe('toast notifications', () => {
	let toasts: ReturnType<typeof createToastManager>;
	let visible: Toast[];
	let unsubscribe: () => void;

	beforeEach(() => {
		vi.useFakeTimers();
		toasts = createToastManager();
		unsubscribe = toasts.subscribe((value) => { visible = value; });
	});

	afterEach(() => {
		toasts.destroy();
		unsubscribe();
		vi.useRealTimers();
	});

	it('dismisses success messages after exactly five seconds', () => {
		toasts.success('Saved');
		vi.advanceTimersByTime(SUCCESS_TOAST_DURATION - 1);
		expect(visible).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(visible).toEqual([]);
	});

	it('keeps errors visible until explicitly dismissed', () => {
		const id = toasts.error('Save failed');
		vi.advanceTimersByTime(60_000);
		expect(visible).toEqual([{ id, kind: 'error', message: 'Save failed' }]);
		toasts.dismiss(id);
		expect(visible).toEqual([]);
	});

	it('treats repeated identical feedback as separate events with independent timers', () => {
		const first = toasts.success('Saved');
		vi.advanceTimersByTime(1000);
		const second = toasts.success('Saved');
		expect(first).not.toBe(second);
		vi.advanceTimersByTime(4000);
		expect(visible.map((toast) => toast.id)).toEqual([second]);
		vi.advanceTimersByTime(1000);
		expect(visible).toEqual([]);
	});

	it('pauses on hover and focus and resumes only when both end', () => {
		const id = toasts.success('Saved');
		vi.advanceTimersByTime(2000);
		toasts.pause(id, 'hover');
		toasts.pause(id, 'hover');
		toasts.pause(id, 'focus');
		vi.advanceTimersByTime(10_000);
		toasts.resume(id, 'hover');
		vi.advanceTimersByTime(10_000);
		expect(visible).toHaveLength(1);
		toasts.resume(id, 'focus');
		vi.advanceTimersByTime(2999);
		expect(visible).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(visible).toEqual([]);
	});

	it('only dismisses the selected notification and cancels its timer', () => {
		const id = toasts.success('Saved');
		const error = toasts.error('Upload failed');
		toasts.dismiss(id);
		expect(vi.getTimerCount()).toBe(0);
		expect(visible.map((toast) => toast.id)).toEqual([error]);
	});

	it('clears all notifications and timers when the provider is destroyed', () => {
		toasts.success('Saved');
		toasts.error('Failed');
		toasts.destroy();
		expect(visible).toEqual([]);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('isolates application instances', () => {
		const other = createToastManager();
		let otherVisible: Toast[] = [];
		const stop = other.subscribe((value) => { otherVisible = value; });
		toasts.success('Only here');
		expect(otherVisible).toEqual([]);
		stop();
		other.destroy();
	});
});
