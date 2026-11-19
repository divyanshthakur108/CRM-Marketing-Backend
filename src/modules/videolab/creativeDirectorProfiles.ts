/**
 * RealCRM Creative Director — Design Profiles, Typography Tokens & Structured Storyboard
 *
 * Implements three reusable professional profiles:
 * 1. LUXURY_EDITORIAL: Playfair serif, warm gold, champagne accents, film crossfades
 * 2. MODERN_MINIMAL: Swiss grotesque sans, high-contrast monochrome, emerald accents, clean dissolves
 * 3. BOLD_COMMERCIAL: High-energy condensed uppercase, electric cyan/amber, dynamic cuts
 */

export type CreativeProfileType = 'LUXURY_EDITORIAL' | 'MODERN_MINIMAL' | 'BOLD_COMMERCIAL';

export interface ProfileDesignTokens {
  name: CreativeProfileType;
  displayName: string;
  pacing: {
    shotDurationSeconds: number;
    transitionDurationSeconds: number;
    endCardDurationSeconds: number;
    transitionType: 'fade' | 'wipeleft' | 'wiperight' | 'smoothdissolve';
  };
  palette: {
    background: string;
    surfaceScrim: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    accentPrimary: string;
    accentSecondary: string;
    dividerColor: string;
    cardBorder: string;
  };
  typography: {
    fontTitle: string;
    fontBody: string;
    titleSize: number;
    subtitleSize: number;
    eyebrowSize: number;
    complianceSize: number;
    letterSpacingEyebrow: number;
    letterSpacingTitle: number;
    textTransformEyebrow: 'uppercase' | 'none';
  };
  motion: {
    zoomStart: number;
    zoomEnd: number;
    cameraMotionType: 'push' | 'drift' | 'pull' | 'pan';
  };
  endCard: {
    layout: 'monogram_crest' | 'modern_grid' | 'bold_cta';
    badgeLabel: string;
    ctaDefault: string;
  };
}

export const CREATIVE_PROFILES: Record<CreativeProfileType, ProfileDesignTokens> = {
  LUXURY_EDITORIAL: {
    name: 'LUXURY_EDITORIAL',
    displayName: 'Luxury Editorial',
    pacing: {
      shotDurationSeconds: 3.2,
      transitionDurationSeconds: 0.6,
      endCardDurationSeconds: 2.8,
      transitionType: 'fade',
    },
    palette: {
      background: '#0B0F17',
      surfaceScrim: 'rgba(11, 15, 23, 0.82)',
      textPrimary: '#FFFFFF',
      textSecondary: '#F3E8D2', // Warm champagne
      textMuted: '#94A3B8',
      accentPrimary: '#D4AF37', // Warm classic gold
      accentSecondary: '#F5E6BE', // Soft cream gold
      dividerColor: 'rgba(212, 175, 55, 0.55)',
      cardBorder: 'rgba(212, 175, 55, 0.35)',
    },
    typography: {
      fontTitle: 'Playfair Display, Georgia, serif',
      fontBody: 'system-ui, -apple-system, sans-serif',
      titleSize: 40,
      subtitleSize: 20,
      eyebrowSize: 13,
      complianceSize: 12,
      letterSpacingEyebrow: 3.2,
      letterSpacingTitle: 0.6,
      textTransformEyebrow: 'uppercase',
    },
    motion: {
      zoomStart: 1.00,
      zoomEnd: 1.045,
      cameraMotionType: 'push',
    },
    endCard: {
      layout: 'monogram_crest',
      badgeLabel: 'SIGNATURE RESIDENCES',
      ctaDefault: 'Private Previews by Appointment',
    },
  },

  MODERN_MINIMAL: {
    name: 'MODERN_MINIMAL',
    displayName: 'Modern Minimal',
    pacing: {
      shotDurationSeconds: 2.6,
      transitionDurationSeconds: 0.45,
      endCardDurationSeconds: 2.6,
      transitionType: 'fade',
    },
    palette: {
      background: '#0F172A',
      surfaceScrim: 'rgba(15, 23, 42, 0.85)',
      textPrimary: '#FFFFFF',
      textSecondary: '#E2E8F0',
      textMuted: '#94A3B8',
      accentPrimary: '#10B981', // Architectural Emerald
      accentSecondary: '#6EE7B7',
      dividerColor: 'rgba(16, 185, 129, 0.50)',
      cardBorder: 'rgba(255, 255, 255, 0.15)',
    },
    typography: {
      fontTitle: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      fontBody: 'system-ui, -apple-system, sans-serif',
      titleSize: 38,
      subtitleSize: 19,
      eyebrowSize: 12,
      complianceSize: 11,
      letterSpacingEyebrow: 2.5,
      letterSpacingTitle: 0.2,
      textTransformEyebrow: 'uppercase',
    },
    motion: {
      zoomStart: 1.03,
      zoomEnd: 1.00,
      cameraMotionType: 'drift',
    },
    endCard: {
      layout: 'modern_grid',
      badgeLabel: 'ARCHITECTURAL RESIDENCES',
      ctaDefault: 'Schedule VIP Site Tour',
    },
  },

  BOLD_COMMERCIAL: {
    name: 'BOLD_COMMERCIAL',
    displayName: 'Bold Commercial',
    pacing: {
      shotDurationSeconds: 2.0,
      transitionDurationSeconds: 0.35,
      endCardDurationSeconds: 2.4,
      transitionType: 'wipeleft',
    },
    palette: {
      background: '#090D16',
      surfaceScrim: 'rgba(9, 13, 22, 0.88)',
      textPrimary: '#FFFFFF',
      textSecondary: '#FEF08A', // Punchy light amber
      textMuted: '#94A3B8',
      accentPrimary: '#F59E0B', // Vibrant amber
      accentSecondary: '#06B6D4', // Vibrant cyan
      dividerColor: 'rgba(245, 158, 11, 0.65)',
      cardBorder: 'rgba(245, 158, 11, 0.40)',
    },
    typography: {
      fontTitle: 'system-ui, -apple-system, sans-serif',
      fontBody: 'system-ui, -apple-system, sans-serif',
      titleSize: 42,
      subtitleSize: 20,
      eyebrowSize: 14,
      complianceSize: 12,
      letterSpacingEyebrow: 3.5,
      letterSpacingTitle: 1.0,
      textTransformEyebrow: 'uppercase',
    },
    motion: {
      zoomStart: 1.00,
      zoomEnd: 1.06,
      cameraMotionType: 'push',
    },
    endCard: {
      layout: 'bold_cta',
      badgeLabel: 'EXCLUSIVE INVESTMENT OPPORTUNITY',
      ctaDefault: 'Register Interest Today',
    },
  },
};

/**
 * Storyboard Structure Schema
 */
export interface StoryboardShot {
  shotIndex: number;
  roomName: string;
  category: string;
  motionPreset: 'cinematic_push' | 'architectural_drift' | 'wide_pull' | 'lateral_pan';
  pacingSeconds: number;
  transitionType: string;
  transitionDuration: number;
  typography: {
    eyebrow: string;
    title: string;
    subtitle: string;
    complianceTag: string;
    headerStartY: number;
    headerEndY: number;
    safeZoneStartY: number;
    safeZoneEndY: number;
  };
}

export interface StoryboardEndCard {
  profile: CreativeProfileType;
  layout: 'monogram_crest' | 'modern_grid' | 'bold_cta';
  badgeLabel: string;
  projectName: string;
  city: string;
  reraNumber?: string;
  ctaText: string;
  durationSeconds: number;
}

export interface StoryboardPlan {
  profile: CreativeProfileType;
  canvas: {
    width: number;
    height: number;
    fps: number;
  };
  totalDurationSeconds: number;
  shots: StoryboardShot[];
  endCard: StoryboardEndCard;
  projectMetadata: {
    projectName: string;
    city: string;
    reraNumber?: string;
    developerName?: string;
    isActualPhotography: boolean;
  };
}

/**
 * Creative Director Engine
 */
export class CreativeDirector {
  public static selectOptimalProfile(input: {
    category?: 'RESIDENTIAL' | 'COMMERCIAL' | 'INDUSTRIAL' | string;
    subtype?: string;
    projectName?: string;
    city?: string;
    campaignObjective?: 'AWARENESS' | 'LEAD_GENERATION' | 'EXCLUSIVE_PREVIEW' | 'HIGH_GROWTH_ROI';
    userOverrideStyle?: string;
  }): CreativeProfileType {
    if (input.userOverrideStyle === 'LUXURY_PRESENTATION') return 'MODERN_MINIMAL';
    if (input.userOverrideStyle === 'MODERN_PROMO_AD') return 'BOLD_COMMERCIAL';
    if (input.userOverrideStyle === 'CINEMATIC_SHOWCASE') return 'LUXURY_EDITORIAL';

    const cat = (input.category || '').toUpperCase();
    const sub = (input.subtype || '').toUpperCase();
    const obj = input.campaignObjective;

    if (
      cat === 'COMMERCIAL' ||
      sub.includes('RETAIL') ||
      sub.includes('OFFICE') ||
      sub.includes('SCO') ||
      obj === 'HIGH_GROWTH_ROI' ||
      obj === 'LEAD_GENERATION'
    ) {
      return 'BOLD_COMMERCIAL';
    }

    if (
      sub.includes('VILLA') ||
      sub.includes('PLOT') ||
      sub.includes('ECO') ||
      sub.includes('TOWNHOUSE') ||
      obj === 'AWARENESS'
    ) {
      return 'MODERN_MINIMAL';
    }

    return 'LUXURY_EDITORIAL';
  }

  public static mapVariationToProfile(variationStyle?: string): CreativeProfileType {
    if (variationStyle === 'LUXURY_PRESENTATION') return 'MODERN_MINIMAL';
    if (variationStyle === 'MODERN_PROMO_AD') return 'BOLD_COMMERCIAL';
    return 'LUXURY_EDITORIAL';
  }

  public static generateStoryboardPlan(params: {
    profileType: CreativeProfileType;
    project: {
      projectName: string;
      city: string;
      reraNumber?: string;
      developerName?: string;
      contactCta?: string;
    };
    shots: Array<{
      roomName: string;
      featureTitle?: string;
      featureDetail?: string;
      cameraPerspective?: string;
      isWideLandscape?: boolean;
    }>;
  }): StoryboardPlan {
    const { profileType, project, shots } = params;
    const tokens = CREATIVE_PROFILES[profileType];

    const motionPresets: Array<'cinematic_push' | 'architectural_drift' | 'wide_pull' | 'lateral_pan'> = [
      'cinematic_push',
      'architectural_drift',
      'wide_pull',
      'lateral_pan',
    ];

    const storyboardShots: StoryboardShot[] = shots.map((s, idx) => {
      const room = (s.roomName || 'Residence').toUpperCase();
      const eyebrow = s.cameraPerspective || `${room} EXPERIENCE`;
      const title = s.featureTitle || `${s.roomName} Residence`;
      const subtitle = s.featureDetail || 'Curated Interiors · Architectural Proportions & Finishes';

      const complianceTag = [
        project.city ? project.city : '',
        project.reraNumber ? `RERA: ${project.reraNumber}` : 'Verified Project Specification',
        'Actual Photography',
      ]
        .filter(Boolean)
        .join('   •   ');

      return {
        shotIndex: idx,
        roomName: s.roomName,
        category: s.roomName,
        motionPreset: motionPresets[idx % motionPresets.length],
        pacingSeconds: tokens.pacing.shotDurationSeconds,
        transitionType: tokens.pacing.transitionType,
        transitionDuration: tokens.pacing.transitionDurationSeconds,
        typography: {
          eyebrow,
          title,
          subtitle,
          complianceTag,
          headerStartY: 195,
          headerEndY: 233,
          // Safe Zone enforcement: Y starts at 1330px, finishes strictly at 1482px (<= 1520px safety buffer)
          safeZoneStartY: 1330,
          safeZoneEndY: 1482,
        },
      };
    });

    const totalDuration = Math.round(
      shots.length * tokens.pacing.shotDurationSeconds +
        tokens.pacing.endCardDurationSeconds -
        shots.length * tokens.pacing.transitionDurationSeconds
    );

    const storyboardEndCard: StoryboardEndCard = {
      profile: profileType,
      layout: tokens.endCard.layout,
      badgeLabel: tokens.endCard.badgeLabel,
      projectName: project.projectName || 'RS Heritage',
      city: project.city || 'Chandigarh',
      reraNumber: project.reraNumber,
      ctaText: project.contactCta || tokens.endCard.ctaDefault,
      durationSeconds: tokens.pacing.endCardDurationSeconds,
    };

    return {
      profile: profileType,
      canvas: {
        width: 1080,
        height: 1920,
        fps: 24,
      },
      totalDurationSeconds: Math.max(12, totalDuration),
      shots: storyboardShots,
      endCard: storyboardEndCard,
      projectMetadata: {
        projectName: project.projectName || 'RS Heritage',
        city: project.city || 'Chandigarh',
        reraNumber: project.reraNumber,
        developerName: project.developerName || 'RS Group',
        isActualPhotography: true,
      },
    };
  }
}

