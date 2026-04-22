/**
 * FacilityRouter — Route high-risk patients to appropriate birth facilities
 * based on acuity level, distance, capability, and insurance acceptance.
 */

import { z } from 'zod';

export const BirthFacilitySchema = z.object({
  id: z.string(),
  name: z.string(),
  level: z.enum(['level_1', 'level_2', 'level_3', 'level_4']),
  location: z.object({ latitude: z.number(), longitude: z.number(), address: z.string() }),
  capabilities: z.object({
    nicu: z.boolean(), nicuLevel: z.enum(['none', 'level_1', 'level_2', 'level_3', 'level_4']).optional(),
    bloodBank: z.boolean(), interventionalRadiology: z.boolean(),
    maternalICU: z.boolean(), anesthesia24_7: z.boolean(),
    obGynOnSite24_7: z.boolean(), highRiskOB: z.boolean(),
  }),
  insurance: z.array(z.string()),
  languages: z.array(z.string()),
  birthVolume: z.number().int().nonnegative().optional(),
  cesareanRate: z.number().min(0).max(100).optional(),
  maternalMorbidityRate: z.number().min(0).max(100).optional(),
  hasDoula: z.boolean().optional(),
  hasMidwife: z.boolean().optional(),
});

export const RoutingResultSchema = z.object({
  patientId: z.string().uuid(),
  routedAt: z.string().datetime(),
  riskLevel: z.string(),
  requiredLevel: z.string(),
  recommendations: z.array(z.object({
    facility: BirthFacilitySchema,
    distanceMiles: z.number(),
    driveTimeMinutes: z.number(),
    matchScore: z.number().min(0).max(100),
    matchReasons: z.array(z.string()),
    concerns: z.array(z.string()),
  })),
  transferPlan: z.object({
    needed: z.boolean(),
    fromFacility: z.string().optional(),
    toFacility: z.string().optional(),
    urgency: z.enum(['planned', 'urgent', 'emergent']).optional(),
    transportMode: z.enum(['private', 'ambulance', 'helicopter']).optional(),
  }),
});

export type BirthFacility = z.infer<typeof BirthFacilitySchema>;
export type RoutingResult = z.infer<typeof RoutingResultSchema>;

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function routeToFacility(
  patientLocation: { latitude: number; longitude: number },
  requiredLevel: BirthFacility['level'],
  insuranceType: string,
  language: string,
  facilities: BirthFacility[]
): RoutingResult['recommendations'] {
  const levelOrder = { level_1: 1, level_2: 2, level_3: 3, level_4: 4 };
  const requiredNum = levelOrder[requiredLevel];

  return facilities
    .filter(f => levelOrder[f.level] >= requiredNum)
    .map(f => {
      const dist = haversineDistance(patientLocation.latitude, patientLocation.longitude, f.location.latitude, f.location.longitude);
      const driveTime = Math.round(dist * 1.5); // Rough estimate

      let score = 50;
      if (levelOrder[f.level] === requiredNum) score += 10;
      if (f.insurance.some(i => i.toLowerCase().includes(insuranceType.toLowerCase()))) score += 15;
      if (f.languages.includes(language)) score += 10;
      score += Math.max(0, 15 - dist * 0.3);
      if (f.capabilities.obGynOnSite24_7) score += 5;
      if (f.capabilities.anesthesia24_7) score += 5;
      if (f.maternalMorbidityRate && f.maternalMorbidityRate < 1) score += 5;

      const matchReasons: string[] = [];
      if (levelOrder[f.level] >= requiredNum) matchReasons.push(`Level ${f.level.split('_')[1]} facility meets acuity requirements`);
      if (f.capabilities.nicu) matchReasons.push(`NICU available (${f.capabilities.nicuLevel})`);
      if (f.capabilities.bloodBank) matchReasons.push('On-site blood bank');

      const concerns: string[] = [];
      if (dist > 30) concerns.push(`${Math.round(dist)} miles — consider birth plan with travel contingency`);
      if (!f.capabilities.anesthesia24_7) concerns.push('Anesthesia not guaranteed 24/7');

      return { facility: f, distanceMiles: Math.round(dist * 10) / 10, driveTimeMinutes: driveTime, matchScore: Math.min(100, Math.round(score)), matchReasons, concerns };
    })
    .sort((a, b) => b.matchScore - a.matchScore);
}
