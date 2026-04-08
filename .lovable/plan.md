

# Fix: Notification Sound Playing on Login

## Problem
When logging in as either admin or seller, a notification sound plays immediately. This is unexpected — sounds should only play for **new** messages arriving after login.

## Root Cause

**Seller side**: `prevUnreadRef` starts at `0`. On first fetch of `unreadCount`, if there are any existing unread messages (e.g. count = 2), the condition `unreadCount > prevUnreadRef.current` is true → sound plays. This is a false positive — those messages existed before login.

**Admin side**: The realtime channel subscribes immediately on login. Supabase may replay recent events or there could be messages arriving during the brief login window triggering the sound.

## Fix

### 1. Seller — `SellerSupportChat.tsx` (line 64, 174-180)
Initialize `prevUnreadRef` to `-1` (sentinel) instead of `0`. On first render, set it to current count without playing sound:

```tsx
const prevUnreadRef = useRef<number>(-1);

useEffect(() => {
  if (prevUnreadRef.current === -1) {
    // First load — just sync, don't play sound
    prevUnreadRef.current = unreadCount;
    return;
  }
  if (unreadCount > prevUnreadRef.current) {
    playSellerNotificationSound();
  }
  prevUnreadRef.current = unreadCount;
}, [unreadCount]);
```

### 2. Admin — `useGlobalSupportNotifications.ts` (line 18-48)
Add a `readyRef` that starts `false` and is set to `true` after a short delay (e.g. 2 seconds) post-subscription. Ignore events during this grace period:

```tsx
const readyRef = useRef(false);

useEffect(() => {
  if (!isAdmin || !authUser) return;
  readyRef.current = false;
  const timer = setTimeout(() => { readyRef.current = true; }, 2000);

  const channel = supabase.channel(...)
    .on('postgres_changes', ..., (payload) => {
      if (!readyRef.current) return; // skip during grace period
      // ... existing logic
    })
    .subscribe();

  return () => {
    clearTimeout(timer);
    supabase.removeChannel(channel);
  };
}, [isAdmin, authUser, queryClient]);
```

### No other changes needed.

## Result
- No sound on login for either role
- Sound still plays for genuinely new messages arriving after login

