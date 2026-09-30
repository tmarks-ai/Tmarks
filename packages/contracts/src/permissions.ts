const PERMISSIONS = {
  BOOKMARKS_CREATE: 'bookmarks.create',
  BOOKMARKS_READ: 'bookmarks.read',
  BOOKMARKS_UPDATE: 'bookmarks.update',
  BOOKMARKS_DELETE: 'bookmarks.delete',
  BOOKMARKS_ALL: 'bookmarks.*',

  BOOKMARK_FOLDERS_CREATE: 'bookmark_folders.create',
  BOOKMARK_FOLDERS_READ: 'bookmark_folders.read',
  BOOKMARK_FOLDERS_UPDATE: 'bookmark_folders.update',
  BOOKMARK_FOLDERS_DELETE: 'bookmark_folders.delete',
  BOOKMARK_FOLDERS_ALL: 'bookmark_folders.*',

  TAGS_CREATE: 'tags.create',
  TAGS_READ: 'tags.read',
  TAGS_UPDATE: 'tags.update',
  TAGS_DELETE: 'tags.delete',
  TAGS_ASSIGN: 'tags.assign',
  TAGS_ALL: 'tags.*',

  TAB_GROUPS_CREATE: 'tab_groups.create',
  TAB_GROUPS_READ: 'tab_groups.read',
  TAB_GROUPS_UPDATE: 'tab_groups.update',
  TAB_GROUPS_DELETE: 'tab_groups.delete',
  TAB_GROUPS_ALL: 'tab_groups.*',

  USER_READ: 'user.read',
  USER_PREFERENCES_READ: 'user.preferences.read',
  USER_PREFERENCES_WRITE: 'user.preferences.write',
} as const

type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS]

const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[]

/**
 * Minimal permission set the browser extension needs to run the full sync cycle
 * (bootstrap/changes = SYNC_READ, push = SYNC_WRITE). Must stay a superset of the
 * SYNC_READ/SYNC_WRITE lists in routes/sync.ts, otherwise a key created with the
 * BASIC template (which mirrors this set) gets 403 on sync and the extension
 * silently falls back to local_only.
 */
const TAB_EXTENSION_REQUIRED_PERMISSIONS = [
  PERMISSIONS.BOOKMARKS_CREATE,
  PERMISSIONS.BOOKMARKS_READ,
  PERMISSIONS.BOOKMARKS_UPDATE,
  PERMISSIONS.BOOKMARKS_DELETE,
  PERMISSIONS.BOOKMARK_FOLDERS_CREATE,
  PERMISSIONS.BOOKMARK_FOLDERS_READ,
  PERMISSIONS.BOOKMARK_FOLDERS_UPDATE,
  PERMISSIONS.BOOKMARK_FOLDERS_DELETE,
  PERMISSIONS.TAGS_CREATE,
  PERMISSIONS.TAGS_READ,
  PERMISSIONS.TAGS_UPDATE,
  PERMISSIONS.TAGS_DELETE,
  PERMISSIONS.TAGS_ASSIGN,
  PERMISSIONS.TAB_GROUPS_CREATE,
  PERMISSIONS.TAB_GROUPS_READ,
  PERMISSIONS.TAB_GROUPS_UPDATE,
  PERMISSIONS.TAB_GROUPS_DELETE,
  PERMISSIONS.USER_READ,
  PERMISSIONS.USER_PREFERENCES_READ,
  PERMISSIONS.USER_PREFERENCES_WRITE,
] as const

export const PERMISSION_TEMPLATES = {
  READ_ONLY: {
    nameKey: 'settings:permissions.templates.readOnly',
    descriptionKey: 'settings:permissions.templates.readOnlyDesc',
    permissions: [
      PERMISSIONS.BOOKMARKS_READ,
      PERMISSIONS.BOOKMARK_FOLDERS_READ,
      PERMISSIONS.TAGS_READ,
      PERMISSIONS.TAB_GROUPS_READ,
      PERMISSIONS.USER_PREFERENCES_READ,
      PERMISSIONS.USER_READ,
    ] as string[],
  },
  BASIC: {
    nameKey: 'settings:permissions.templates.basic',
    descriptionKey: 'settings:permissions.templates.basicDesc',
    permissions: [...TAB_EXTENSION_REQUIRED_PERMISSIONS] as string[],
  },
  FULL: {
    nameKey: 'settings:permissions.templates.full',
    descriptionKey: 'settings:permissions.templates.fullDesc',
    permissions: [
      PERMISSIONS.BOOKMARKS_ALL,
      PERMISSIONS.BOOKMARK_FOLDERS_ALL,
      PERMISSIONS.TAGS_ALL,
      PERMISSIONS.TAB_GROUPS_ALL,
      PERMISSIONS.USER_READ,
      PERMISSIONS.USER_PREFERENCES_READ,
      PERMISSIONS.USER_PREFERENCES_WRITE,
    ] as string[],
  },
} as const

export type PermissionTemplate = keyof typeof PERMISSION_TEMPLATES

const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS)

function isKnownPermission(permission: string): permission is Permission {
  return PERMISSION_SET.has(permission)
}

export function getInvalidPermissions(permissions: readonly string[]): string[] {
  return permissions.filter((permission) => !isKnownPermission(permission))
}

export function normalizePermissions(permissions: readonly string[]): Permission[] {
  const normalized: Permission[] = []
  const seen = new Set<string>()

  for (const permission of permissions) {
    if (!isKnownPermission(permission) || seen.has(permission)) continue
    seen.add(permission)
    normalized.push(permission)
  }

  return normalized
}

export function hasPermission(userPermissions: string[], requiredPermission: string): boolean {
  return userPermissions.some((permission) => {
    if (permission === requiredPermission) return true
    if (permission.endsWith('.*')) {
      const prefix = permission.slice(0, -2)
      return requiredPermission.startsWith(`${prefix}.`)
    }
    return false
  })
}
