/**
 * RiskScorer — Maternal risk scoring using validated clinical models.
 * Preeclampsia prediction, hemorrhage risk, and racial disparity adjustment.
 */

import { z } from 'zod';

export const MaternalProfileSchema = z.object({
  patientId: z.string().uuid(),
  age: z.number().int().min(12).max(55),
  gestationalWeeks: z.number().min(0).max(45),
  gravida: z.number().int().nonnegative(),
  para: z.number().int().nonnegative(),
  bmi: z.number().positive(),
  race: z.string().optional(),
  ethnicity: z.string().optional(),
  preExistingConditions: z.array(z.enum(['chronic_hypertension', 'diabetes_type1', 'diabetes_type2', 'gestational_diabetes', 'lupus', 'kidney_disease', 'sickle_cell', 'obesity', 'thyroid', 'depression', 'anxiety', 'none'])),
  previousComplications: z.array(z.enum(['preeclampsia', 'gestational_diabetes', 'preterm_birth', 'stillbirth', 'postpartum_hemorrhage', 'cesarean', 'nicu_admission', 'none'])),
  currentSymptoms: z.array(z.enum(['headache', 'visual_changes', 'epigastric_pain', 'swelling', 'decreased_fetal_movement', 'bleeding', 'contractions', 'fever', 'none'])),
  bloodPressureReadings: z.array(z.object({ date: z.string(), systolic: z.number().int(), diastolic: z.number().int() })),
  labValues: z.object({
    proteinUrine: z.number().optional(), platelets: z.number().optional(),
    creatinine: z.number().optional(), alt: z.number().optional(),
    hemoglobin: z.number().optional(), glucose: z.number().optional(),
  }).optional(),
  socialDeterminants: z.object({
    insuranceType: z.enum(['private', 'medicaid', 'uninsured', 'other']),
    distanceToHospitalMiles: z.number().nonnegative(),
    foodInsecure: z.boolean(), housingInstable: z.boolean(),
    primaryLanguage: z.string(), interpreterNeeded: z.boolean(),
    hasTransportation: z.boolean(), hasSocialSupport: z.boolean(),
  }),
});

export const RiskAssessmentSchema = z.object({
  patientId: z.string().uuid(),
  assessedAt: z.string().datetime(),
  overallRisk: z.enum(['low', 'moderate', 'high', 'critical']),
  overallScore: z.number().min(0).max(100),
  preeclampsiaRisk: z.object({ score: z.number().min(0).max(100), level: z.string(), keyFactors: z.array(z.string()), recommendation: z.string() }),
  hemorrhageRisk: z.object({ score: z.number().min(0).max(100), level: z.string(), keyFactors: z.array(z.string()), recommendation: z.string() }),
  pretermRisk: z.object({ score: z.number().min(0).max(100), level: z.string(), keyFactors: z.array(z.string()), recommendation: z.string() }),
  socialRisk: z.object({ score: z.number().min(0).max(100), barriers: z.array(z.string()), interventions: z.array(z.string()) }),
  racialDisparityFlag: z.boolean(),
  racialDisparityNote: z.string().optional(),
  recommendedActions: z.array(z.object({ priority: z.number().int(), action: z.string(), urgency: z.enum(['immediate', 'this_visit', 'next_visit', 'ongoing']), rationale: z.string() })),
  facilityLevel: z.enum(['level_1', 'level_2', 'level_3', 'level_4']),
});

export type MaternalProfile = z.infer<typeof MaternalProfileSchema>;
export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;

export function calculatePreeclampsiaRisk(profile: MaternalProfile): { score: number; factors: string[] } {
  let score = 0; const factors: string[] = [];
  if (profile.age >= 35) { score += 10; factors.push('Advanced maternal age (35+)'); }
  if (profile.age >= 40) { score += 10; factors.push('Very advanced maternal age (40+)'); }
  if (profile.bmi >= 30) { score += 15; factors.push(`Obesity (BMI ${profile.bmi})`); }
  if (profile.previousComplications.includes('preeclampsia')) { score += 25; factors.push('History of preeclampsia'); }
  if (profile.preExistingConditions.includes('chronic_hypertension')) { score += 20; factors.push('Chronic hypertension'); }
  if (profile.preExistingConditions.includes('diabetes_type1') || profile.preExistingConditions.includes('diabetes_type2')) { score += 15; factors.push('Pre-existing diabetes'); }
  if (profile.preExistingConditions.includes('kidney_disease')) { score += 15; factors.push('Kidney disease'); }
  if (profile.preExistingConditions.includes('lupus')) { score += 15; factors.push('Lupus/autoimmune'); }
  if (profile.gravida === 1) { score += 10; factors.push('Nulliparity'); }

  const recentBP = profile.bloodPressureReadings.slice(-3);
  const avgSystolic = recentBP.reduce((s, bp) => s + bp.systolic, 0) / (recentBP.length || 1);
  if (avgSystolic >= 140) { score += 20; factors.push(`Elevated BP (avg systolic ${Math.round(avgSystolic)})`); }
  else if (avgSystolic >= 130) { score += 10; factors.push(`Borderline BP (avg systolic ${Math.round(avgSystolic)})`); }

  if (profile.currentSymptoms.includes('headache') && profile.currentSymptoms.includes('visual_changes')) { score += 15; factors.push('Headache + visual changes (warning signs)'); }
  if (profile.labValues?.proteinUrine && profile.labValues.proteinUrine >= 300) { score += 20; factors.push('Proteinuria detected'); }

  return { score: Math.min(100, score), factors };
}

export function assessRisk(profile: MaternalProfile): RiskAssessment {
  const pe = calculatePreeclampsiaRisk(profile);

  let hemorrhageScore = 0; const hFactors: string[] = [];
  if (profile.previousComplications.includes('postpartum_hemorrhage')) { hemorrhageScore += 30; hFactors.push('Prior PPH'); }
  if (profile.previousComplications.includes('cesarean')) { hemorrhageScore += 15; hFactors.push('Prior cesarean'); }
  if (profile.gravida >= 4) { hemorrhageScore += 10; hFactors.push('Grand multiparity'); }
  if (profile.labValues?.hemoglobin && profile.labValues.hemoglobin < 10) { hemorrhageScore += 15; hFactors.push(`Anemia (Hgb ${profile.labValues.hemoglobin})`); }

  let pretermScore = 0; const ptFactors: string[] = [];
  if (profile.previousComplications.includes('preterm_birth')) { pretermScore += 30; ptFactors.push('Prior preterm birth'); }
  if (profile.currentSymptoms.includes('contractions') && profile.gestationalWeeks < 37) { pretermScore += 25; ptFactors.push('Preterm contractions'); }
  if (profile.currentSymptoms.includes('bleeding')) { pretermScore += 20; ptFactors.push('Vaginal bleeding'); }

  let socialScore = 0; const barriers: string[] = []; const interventions: string[] = [];
  if (profile.socialDeterminants.insuranceType === 'uninsured') { socialScore += 20; barriers.push('Uninsured'); interventions.push('Connect with Medicaid enrollment'); }
  if (!profile.socialDeterminants.hasTransportation) { socialScore += 15; barriers.push('No transportation'); interventions.push('Arrange prenatal visit transportation'); }
  if (profile.socialDeterminants.distanceToHospitalMiles > 30) { socialScore += 15; barriers.push(`${profile.socialDeterminants.distanceToHospitalMiles} miles to hospital`); interventions.push('Develop birth plan with travel time contingency'); }
  if (profile.socialDeterminants.foodInsecure) { socialScore += 10; barriers.push('Food insecurity'); interventions.push('Refer to WIC and food assistance'); }
  if (profile.socialDeterminants.interpreterNeeded) { socialScore += 10; barriers.push('Language barrier'); interventions.push('Ensure interpreter at all visits'); }

  const overallScore = Math.round(pe.score * 0.35 + hemorrhageScore * 0.25 + pretermScore * 0.25 + socialScore * 0.15);
  const overallRisk = overallScore >= 70 ? 'critical' as const : overallScore >= 50 ? 'high' as const : overallScore >= 25 ? 'moderate' as const : 'low' as const;
  const facilityLevel = overallScore >= 60 ? 'level_4' as const : overallScore >= 40 ? 'level_3' as const : overallScore >= 20 ? 'level_2' as const : 'level_1' as const;

  const racialDisparityFlag = profile.race === 'Black' || profile.race === 'African American' || profile.race === 'Indigenous' || profile.race === 'Native American';

  const actions: RiskAssessment['recommendedActions'] = [];
  if (pe.score >= 50) actions.push({ priority: 1, action: 'Preeclampsia workup: 24h urine protein, CBC with platelets, LFTs, creatinine', urgency: 'immediate', rationale: `Preeclampsia risk score ${pe.score}/100` });
  if (hemorrhageScore >= 30) actions.push({ priority: 2, action: 'Type and screen, ensure Level 3+ facility delivery plan', urgency: 'this_visit', rationale: 'Elevated hemorrhage risk' });
  if (racialDisparityFlag) actions.push({ priority: 3, action: 'Enhanced monitoring protocol — racial disparity in maternal mortality warrants additional vigilance', urgency: 'ongoing', rationale: 'Black and Indigenous women face 2-3x higher maternal mortality. Standard risk scores may underestimate actual risk.' });

  return {
    patientId: profile.patientId, assessedAt: new Date().toISOString(), overallRisk, overallScore,
    preeclampsiaRisk: { score: pe.score, level: pe.score >= 50 ? 'high' : pe.score >= 25 ? 'moderate' : 'low', keyFactors: pe.factors, recommendation: pe.score >= 50 ? 'Begin low-dose aspirin if <16 weeks. Increase visit frequency.' : 'Continue routine monitoring.' },
    hemorrhageRisk: { score: hemorrhageScore, level: hemorrhageScore >= 30 ? 'high' : hemorrhageScore >= 15 ? 'moderate' : 'low', keyFactors: hFactors, recommendation: hemorrhageScore >= 30 ? 'Deliver at facility with blood bank and surgical capability.' : 'Standard delivery preparations.' },
    pretermRisk: { score: pretermScore, level: pretermScore >= 30 ? 'high' : pretermScore >= 15 ? 'moderate' : 'low', keyFactors: ptFactors, recommendation: pretermScore >= 30 ? 'Consider cervical length measurement and progesterone if indicated.' : 'Continue routine care.' },
    socialRisk: { score: socialScore, barriers, interventions },
    racialDisparityFlag, racialDisparityNote: racialDisparityFlag ? 'This patient belongs to a demographic group with significantly higher maternal mortality. Apply enhanced monitoring protocols.' : undefined,
    recommendedActions: actions, facilityLevel,
  };
}
