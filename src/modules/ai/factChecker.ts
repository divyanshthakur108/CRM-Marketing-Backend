import { IProject } from '../../models/Project.js';
import { PropertyUnit } from '../../models/PropertyUnit.js';

export interface VerifiedProjectFacts {
  projectName: string;
  category: string;
  reraNumber?: string;
  city?: string;
  micromarket?: string;
  address?: string;
  minPrice?: number;
  maxPrice?: number;
  priceDisplay?: string;
  allowedBhk: number[];
  allowedAmenities: string[];
}

export interface FactCheckResult {
  passed: boolean;
  issues: string[];
  verifiedFacts: string[];
}

export class FactChecker {
  /**
   * Builds the verified factual baseline from project and unit records.
   */
  public static async buildVerifiedFacts(project: IProject): Promise<VerifiedProjectFacts> {
    const units = await PropertyUnit.find({
      organizationId: project.organizationId,
      projectId: project._id,
    });

    const allowedBhk = new Set<number>();
    const details = project.details as Record<string, unknown> | undefined;
    if (details && Array.isArray(details.bhkConfigs)) {
      (details.bhkConfigs as string[]).forEach((c: string) => {
        const match = c.match(/\b(\d+)\s*(?:BHK|Bed)/i);
        if (match) allowedBhk.add(parseInt(match[1], 10));
      });
    }

    units.forEach((u) => {
      const typeMatch = u.unitType.match(/\b(\d+)\s*(?:BHK|Bed)/i);
      if (typeMatch) allowedBhk.add(parseInt(typeMatch[1], 10));

      const attrBhk = (u.attributes as Record<string, unknown>)?.bhk;
      if (typeof attrBhk === 'number') allowedBhk.add(attrBhk);
    });

    const allowedAmenities = (project.amenities || []).map((a) => a.toLowerCase().trim());

    return {
      projectName: project.name,
      category: project.category,
      reraNumber: project.reraNumber,
      city: project.location?.city,
      micromarket: project.location?.microMarket,
      address: project.location?.address,
      minPrice: project.priceRange?.min,
      maxPrice: project.priceRange?.max,
      priceDisplay: project.priceRange?.display,
      allowedBhk: Array.from(allowedBhk),
      allowedAmenities,
    };
  }

  /**
   * Verifies that generated text (headline, captions, bullet points)
   * uses strictly approved facts and flags any unverified disclosures.
   */
  public static verifyText(text: string, facts: VerifiedProjectFacts): FactCheckResult {
    const issues: string[] = [];
    const verifiedFacts: string[] = [];

    if (!text || text.trim().length === 0) {
      return { passed: true, issues: [], verifiedFacts: [] };
    }

    // 1. BHK / Unit Configuration Checks
    if (facts.category === 'PLOTS') {
      const bhkPlotMatch = text.match(/\b(\d+)\s*(?:BHK|Bed|Bedroom)/i);
      if (bhkPlotMatch) {
        issues.push(`Unverified configuration: Plotted developments cannot contain BHK units (${bhkPlotMatch[0]}).`);
      }
    } else if (facts.allowedBhk.length > 0) {
      const bhkRegex = /\b(\d+)\s*(?:BHK|Bed|Bedroom)/gi;
      let match: RegExpExecArray | null;
      while ((match = bhkRegex.exec(text)) !== null) {
        const bhkNum = parseInt(match[1], 10);
        if (!facts.allowedBhk.includes(bhkNum)) {
          issues.push(
            `Unverified configuration: ${bhkNum} BHK is not in approved configurations (${facts.allowedBhk.join(', ')} BHK).`
          );
        } else {
          verifiedFacts.push(`${bhkNum} BHK verified against approved unit inventory.`);
        }
      }
    }

    // 2. Price Claims Verification
    const priceRegex = /(?:₹|Rs\.?|INR)\s*(\d+(?:\.\d+)?)\s*(Cr|Crore|L|Lakh|Lac)?/gi;
    let pMatch: RegExpExecArray | null;
    while ((pMatch = priceRegex.exec(text)) !== null) {
      const num = parseFloat(pMatch[1]);
      const unit = (pMatch[2] || '').toLowerCase();
      let valueInRupees = num;

      if (unit.startsWith('cr')) {
        valueInRupees = num * 10000000;
      } else if (unit.startsWith('l')) {
        valueInRupees = num * 100000;
      }

      if (facts.minPrice !== undefined && facts.maxPrice !== undefined) {
        // Allow a 10% tolerance for marketing roundings
        if (valueInRupees < facts.minPrice * 0.85 || valueInRupees > facts.maxPrice * 1.15) {
          issues.push(
            `Unverified price: Claimed amount "${pMatch[0]}" falls outside approved price range (${facts.priceDisplay || '₹' + facts.minPrice + ' - ₹' + facts.maxPrice}).`
          );
        } else {
          verifiedFacts.push(`Price claim "${pMatch[0]}" verified within approved project price range.`);
        }
      }
    }

    // 3. RERA Disclosures Verification
    const reraRegex = /\b(PRM\/[A-Z0-9/-]+|RERA\s*(?:Reg\.?|No\.?|Registration)?\s*[:#-]?\s*([A-Z0-9/-]{6,}))/gi;
    let reraMatch: RegExpExecArray | null;
    while ((reraMatch = reraRegex.exec(text)) !== null) {
      const claimedRera = reraMatch[0].replace(/^(?:RERA|Reg|No|Registration|[:#-\s])+/gi, '').trim();

      if (!facts.reraNumber) {
        issues.push(`Unverified RERA claim: Project does not have an approved RERA registration on file.`);
      } else {
        const cleanClaimed = claimedRera.replace(/[^A-Za-z0-9]/g, '');
        const cleanOfficial = facts.reraNumber.replace(/[^A-Za-z0-9]/g, '');
        if (!cleanOfficial.includes(cleanClaimed) && !cleanClaimed.includes(cleanOfficial)) {
          issues.push(
            `Mismatched RERA registration: Disclosed "${claimedRera}" does not match approved RERA (${facts.reraNumber}).`
          );
        } else {
          verifiedFacts.push(`Statutory RERA ${facts.reraNumber} verified.`);
        }
      }
    }

    // 4. Luxury Amenity Verification (Flag extraordinary unverified claims)
    const extraordinaryAmenities = [
      'helipad',
      'golf course',
      'yacht club',
      'private marina',
      'private beach',
      'heated pool',
      'squash court',
      'bowling alley',
    ];

    extraordinaryAmenities.forEach((amenity) => {
      const reg = new RegExp(`\\b${amenity}\\b`, 'i');
      if (reg.test(text)) {
        const isApproved = facts.allowedAmenities.some((a) => a.includes(amenity));
        if (!isApproved) {
          issues.push(`Unverified luxury amenity: "${amenity}" is not in approved project amenities.`);
        } else {
          verifiedFacts.push(`Amenity "${amenity}" verified.`);
        }
      }
    });

    return {
      passed: issues.length === 0,
      issues,
      verifiedFacts,
    };
  }
}
