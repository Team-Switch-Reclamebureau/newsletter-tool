import { getContext, setContext } from 'svelte';
import { createToastManager, type ToastManager } from './toasts';

const TOAST_CONTEXT = Symbol('notifications');

export function provideToasts() {
	return setContext(TOAST_CONTEXT, createToastManager());
}

export function useToasts() {
	const toasts = getContext<ToastManager | undefined>(TOAST_CONTEXT);
	if (!toasts) throw new Error('Notifications require the application toast provider.');
	return toasts;
}
