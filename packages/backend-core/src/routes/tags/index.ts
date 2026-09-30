import { Hono } from 'hono'
import type { AppEnv } from '../../lib/env'
import { requireDataAuth } from '../../middleware/data-auth'
import { listTagsHandler } from './list'
import { createTagHandler } from './create'
import { getTagHandler } from './get'
import { updateTagHandler } from './update'
import { deleteTagHandler } from './delete'
import { clickTagHandler } from './click'

const tagIdRoutes = new Hono<AppEnv>()

tagIdRoutes.get('/', requireDataAuth('tags.read'), getTagHandler)
tagIdRoutes.patch('/', requireDataAuth('tags.update'), updateTagHandler)
tagIdRoutes.delete('/', requireDataAuth('tags.delete'), deleteTagHandler)
tagIdRoutes.patch('/click', requireDataAuth('tags.update'), clickTagHandler)

/**
 * Tag routes, mounted at /api/v1/tags. Read access uses
 * `tags.read`; create/update/delete use the matching permissions.
 */
export const tagRoutes = new Hono<AppEnv>()

tagRoutes.get('/', requireDataAuth('tags.read'), listTagsHandler)
tagRoutes.post('/', requireDataAuth('tags.create'), createTagHandler)
tagRoutes.route('/:id', tagIdRoutes)
