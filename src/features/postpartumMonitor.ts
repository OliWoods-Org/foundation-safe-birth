/**
 * PostpartumMonitor — SMS-based postpartum check-in system
 * with warning sign detection and escalation protocols.
 */

import { z } from 'zod';

export const PostpartumCheckInSchema = z.object({
  patientId: z.string().uuid(),
  checkInNumber: z.number().int().positive(),
  dayPostpartum: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  responses: z.object({
    bleeding: z.enum(['none', 'light', 'moderate', 'heavy', 'soaking_pad_hourly']),
    temperature: z.number().optional(),
    painLevel: z.number().int().min(0).max(10),
    mood: z.enum(['good', 'okay', 'sad', 'very_sad', 'hopeless', 'thoughts_of_harm']),
    breastfeeding: z.enum(['going_well', 'some_issues', 'significant_pain', 'not_breastfeeding']).optional(),
    incisionSite: z.enum(['healing_well', 'redness', 'swelling', 'drainage', 'opening', 'not_applicable']).optional(),
    urination: z.enum(['normal', 'burning', 'difficulty', 'blood_in_urine']),
    headache: z.boolean(),
    visionChanges: z.boolean(),
    legSwelling: z.enum(['none', 'mild', 'one_leg_worse', 'severe']),
    breathingDifficulty: z.boolean(),
    babyFeeding: z.enum(['well', 'some_difficulty', 'not_feeding', 'concerned']).optional(),
  }),
});

export const PostpartumAlertSchema = z.object({
  patientId: z.string().uuid(),
  generatedAt: z.string().datetime(),
  severity: z.enum(['routine', 'attention', 'urgent', 'emergency']),
  triggers: z.array(z.object({ symptom: z.string(), value: z.string(), concern: z.string(), action: z.string() })),
  overallRecommendation: z.string(),
  escalateTo: z.enum(['none', 'nurse_line', 'provider_call', 'emergency_room', 'call_911']),
  mentalHealthScreen: z.object({
    score: z.number().int().min(0).max(10),
    flag: z.boolean(),
    recommendation: z.string(),
  }),
});

export const CheckInScheduleSchema = z.object({
  patientId: z.string().uuid(),
  deliveryDate: z.string(),
  deliveryType: z.enum(['vaginal', 'cesarean']),
  schedule: z.array(z.object({ dayPostpartum: z.number().int(), scheduledAt: z.string().datetime(), completed: z.boolean(), alertGenerated: z.boolean() })),
  riskLevel: z.enum(['standard', 'enhanced', 'high_risk']),
});

export type PostpartumCheckIn = z.infer<typeof PostpartumCheckInSchema>;
export type PostpartumAlert = z.infer<typeof PostpartumAlertSchema>;
export type CheckInSchedule = z.infer<typeof CheckInScheduleSchema>;

export function analyzeCheckIn(checkIn: PostpartumCheckIn): PostpartumAlert {
  const triggers: PostpartumAlert['triggers'] = [];
  let maxSeverity = 'routine' as PostpartumAlert['severity'];
  const r = checkIn.responses;

  // Hemorrhage warning signs
  if (r.bleeding === 'soaking_pad_hourly') {
    triggers.push({ symptom: 'Bleeding', value: 'Soaking pad hourly', concern: 'Possible postpartum hemorrhage', action: 'Call 911 immediately' });
    maxSeverity = 'emergency';
  } else if (r.bleeding === 'heavy') {
    triggers.push({ symptom: 'Bleeding', value: 'Heavy', concern: 'Heavy postpartum bleeding', action: 'Call provider now' });
    if (maxSeverity !== 'emergency') maxSeverity = 'urgent';
  }

  // Infection signs
  if (r.temperature && r.temperature >= 100.4) {
    triggers.push({ symptom: 'Temperature', value: `${r.temperature}F`, concern: 'Possible postpartum infection', action: 'Contact provider within 1 hour' });
    if (maxSeverity !== 'emergency') maxSeverity = 'urgent';
  }

  // Preeclampsia (can develop postpartum)
  if (r.headache && r.visionChanges) {
    triggers.push({ symptom: 'Headache + vision changes', value: 'Both present', concern: 'Possible postpartum preeclampsia', action: 'Go to emergency room now' });
    maxSeverity = 'emergency';
  }

  // DVT signs
  if (r.legSwelling === 'one_leg_worse') {
    triggers.push({ symptom: 'Leg swelling', value: 'One leg significantly worse', concern: 'Possible deep vein thrombosis', action: 'Seek immediate medical evaluation' });
    maxSeverity = 'emergency';
  }

  if (r.breathingDifficulty) {
    triggers.push({ symptom: 'Breathing difficulty', value: 'Present', concern: 'Possible pulmonary embolism or cardiomyopathy', action: 'Call 911 immediately' });
    maxSeverity = 'emergency';
  }

  // Incision complications
  if (r.incisionSite === 'opening' || r.incisionSite === 'drainage') {
    triggers.push({ symptom: 'Incision', value: r.incisionSite, concern: 'Wound complication', action: 'Contact provider today' });
    if (maxSeverity === 'routine') maxSeverity = 'urgent';
  }

  // Mental health screening
  let mentalHealthScore = 0;
  if (r.mood === 'sad') mentalHealthScore = 3;
  else if (r.mood === 'very_sad') mentalHealthScore = 6;
  else if (r.mood === 'hopeless') mentalHealthScore = 8;
  else if (r.mood === 'thoughts_of_harm') mentalHealthScore = 10;

  const mentalHealthFlag = mentalHealthScore >= 6;
  if (r.mood === 'thoughts_of_harm') {
    triggers.push({ symptom: 'Mental health', value: 'Thoughts of harm', concern: 'Perinatal mental health crisis', action: 'Call 988 Suicide & Crisis Lifeline or Postpartum Support International 1-800-944-4773' });
    maxSeverity = 'emergency';
  } else if (mentalHealthFlag) {
    triggers.push({ symptom: 'Mental health', value: r.mood, concern: 'Possible postpartum depression', action: 'Schedule mental health evaluation with provider' });
    if (maxSeverity === 'routine') maxSeverity = 'attention';
  }

  const escalateTo = maxSeverity === 'emergency' ? 'call_911' as const
    : maxSeverity === 'urgent' ? 'provider_call' as const
    : maxSeverity === 'attention' ? 'nurse_line' as const
    : 'none' as const;

  return {
    patientId: checkIn.patientId, generatedAt: new Date().toISOString(),
    severity: maxSeverity, triggers,
    overallRecommendation: maxSeverity === 'emergency' ? 'SEEK IMMEDIATE MEDICAL ATTENTION' : maxSeverity === 'urgent' ? 'Contact your provider today' : maxSeverity === 'attention' ? 'Monitor and discuss at next visit' : 'All responses within normal range',
    escalateTo,
    mentalHealthScreen: { score: mentalHealthScore, flag: mentalHealthFlag, recommendation: mentalHealthScore >= 8 ? 'Immediate mental health crisis intervention' : mentalHealthFlag ? 'Screen with Edinburgh Postnatal Depression Scale at next visit' : 'Continue routine mood monitoring' },
  };
}

export function generateCheckInSchedule(patientId: string, deliveryDate: string, deliveryType: 'vaginal' | 'cesarean', riskLevel: 'standard' | 'enhanced' | 'high_risk'): CheckInSchedule {
  const baseDate = new Date(deliveryDate).getTime();
  const standardDays = [1, 3, 7, 14, 21, 42];
  const enhancedDays = [1, 2, 3, 5, 7, 10, 14, 21, 28, 42];
  const highRiskDays = [1, 2, 3, 4, 5, 7, 10, 14, 21, 28, 35, 42, 56, 84];
  const days = riskLevel === 'high_risk' ? highRiskDays : riskLevel === 'enhanced' ? enhancedDays : standardDays;
  if (deliveryType === 'cesarean' && !days.includes(5)) days.splice(3, 0, 5);

  return {
    patientId, deliveryDate, deliveryType, riskLevel,
    schedule: days.map(d => ({ dayPostpartum: d, scheduledAt: new Date(baseDate + d * 86400000).toISOString(), completed: false, alertGenerated: false })),
  };
}
