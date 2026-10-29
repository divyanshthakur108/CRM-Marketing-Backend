import { Router } from 'express';
import { projectController } from './controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { authorize } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

// Enforce full authentication and tenant resolution on all project routes
router.use(authenticate);
router.use(resolveTenant);

// Project Endpoints
router.get('/', authorize('projects:read'), asyncHandler(projectController.listProjects));
router.post('/', authorize('projects:create'), asyncHandler(projectController.createProject));
router.get('/:id', authorize('projects:read'), asyncHandler(projectController.getProject));
router.patch('/:id', authorize('projects:update'), asyncHandler(projectController.updateProject));
router.post('/:id/submit', authorize('projects:update'), asyncHandler(projectController.submitProject));
router.delete('/:id', authorize('projects:delete'), asyncHandler(projectController.deleteProject));
router.get(
  '/:id/public-ad',
  authorize('projects:read'),
  asyncHandler(projectController.getPublicAdProject)
);

// Property Units Endpoints
router.get('/:id/units', authorize('projects:read'), asyncHandler(projectController.listUnits));
router.post('/:id/units', authorize('units:manage'), asyncHandler(projectController.createUnit));
router.get(
  '/:id/units/:unitId',
  authorize('projects:read'),
  asyncHandler(projectController.getUnit)
);
router.patch(
  '/:id/units/:unitId',
  authorize('units:manage'),
  asyncHandler(projectController.updateUnit)
);
router.delete(
  '/:id/units/:unitId',
  authorize('units:manage'),
  asyncHandler(projectController.deleteUnit)
);

export default router;
