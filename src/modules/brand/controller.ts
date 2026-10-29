import { Request, Response } from 'express';
import { brandService } from './service.js';
import { updateBrandSchema } from './validation.js';
import { AppError } from '../../utils/AppError.js';

class BrandController {
  public getBrand = async (req: Request, res: Response): Promise<void> => {
    if (!req.membership) {
      throw AppError.forbidden('Organization membership required');
    }

    const profile = await brandService.getBrandProfile(req.membership.organizationId);

    res.status(200).json({
      success: true,
      data: profile,
    });
  };

  public updateBrand = async (req: Request, res: Response): Promise<void> => {
    if (!req.membership) {
      throw AppError.forbidden('Organization membership required');
    }

    const validated = updateBrandSchema.parse(req.body);
    const profile = await brandService.updateBrandProfile(
      req.membership.organizationId,
      validated
    );

    res.status(200).json({
      success: true,
      data: profile,
      message: 'Brand profile updated successfully',
    });
  };
}

export const brandController = new BrandController();
