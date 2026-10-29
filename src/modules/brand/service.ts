import { Types } from 'mongoose';
import { BrandProfile, IBrandProfile } from '../../models/BrandProfile.js';
import { UpdateBrandInput } from './validation.js';

class BrandService {
  private toObjectId(id: Types.ObjectId | string): Types.ObjectId {
    return typeof id === 'string' ? new Types.ObjectId(id) : id;
  }

  public async getBrandProfile(orgId: Types.ObjectId | string): Promise<IBrandProfile> {
    const organizationId = this.toObjectId(orgId);
    let profile = await BrandProfile.findOne({ organizationId });

    if (!profile) {
      profile = await BrandProfile.create({
        organizationId,
        primaryColor: '#000000',
        secondaryColor: '#525252',
        accentColor: '#D4AF37',
        tone: 'Ultra Luxury, Exclusive, Sophisticated',
        supportedLanguages: ['English', 'Hindi', 'Hinglish'],
        defaultDisclaimer:
          'All images and specifications are artistic impressions. Prices subject to change without prior notice. Subject to State RERA conditions.',
      });
    }

    return profile;
  }

  public async updateBrandProfile(
    orgId: Types.ObjectId | string,
    input: UpdateBrandInput
  ): Promise<IBrandProfile> {
    const organizationId = this.toObjectId(orgId);
    let profile = await BrandProfile.findOne({ organizationId });

    if (!profile) {
      profile = new BrandProfile({
        organizationId,
        ...input,
      });
    } else {
      if (input.logoUrl !== undefined) profile.logoUrl = input.logoUrl;
      if (input.watermarkUrl !== undefined) profile.watermarkUrl = input.watermarkUrl;
      if (input.primaryColor) profile.primaryColor = input.primaryColor;
      if (input.secondaryColor) profile.secondaryColor = input.secondaryColor;
      if (input.accentColor) profile.accentColor = input.accentColor;
      if (input.tone) profile.tone = input.tone;
      if (input.supportedLanguages) profile.supportedLanguages = input.supportedLanguages;
      if (input.defaultDisclaimer !== undefined) profile.defaultDisclaimer = input.defaultDisclaimer;
    }

    await profile.save();
    return profile;
  }
}

export const brandService = new BrandService();
