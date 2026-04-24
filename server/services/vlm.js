import OpenAI from 'openai';
import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';

const obstacleSchema = z.object({
  obstacle_type: z.enum([
    'stairs',
    'broken_pavement',
    'construction_barrier',
    'flooded_walkway',
    'steep_curb',
    'fallen_object',
    'narrow_passage',
    'crowd_blockage',
    'poor_lighting',
    'unknown'
  ]),
  analysis_mode: z.enum(['vision', 'heuristic']),
  severity: z.enum(['low', 'medium', 'high']),
  passable_for_elderly: z.boolean(),
  passable_for_wheelchair: z.boolean(),
  estimated_clear_width_m: z.number().min(0).max(10),
  recommended_action: z.enum(['continue', 'warning_only', 'reroute']),
  confidence: z.number().min(0).max(1),
  short_reason: z.string().min(4).max(160)
});

function heuristicObstacleAnalysis({ note = '', profile }) {
  const text = note.toLowerCase();
  const obstacleType = text.includes('stairs')
    ? 'stairs'
    : text.includes('construction')
      ? 'construction_barrier'
      : text.includes('flood') || text.includes('puddle')
        ? 'flooded_walkway'
        : text.includes('crowd')
          ? 'crowd_blockage'
          : text.includes('narrow')
            ? 'narrow_passage'
            : text.includes('curb')
              ? 'steep_curb'
              : text.includes('dark')
                ? 'poor_lighting'
                : text.includes('broken')
                  ? 'broken_pavement'
                  : 'unknown';

  const highRisk =
    obstacleType === 'stairs' ||
    obstacleType === 'construction_barrier' ||
    obstacleType === 'flooded_walkway';

  return obstacleSchema.parse({
    obstacle_type: obstacleType,
    analysis_mode: 'heuristic',
    severity: highRisk ? 'high' : 'medium',
    passable_for_elderly: !highRisk,
    passable_for_wheelchair:
      obstacleType !== 'stairs' && obstacleType !== 'narrow_passage' && !highRisk,
    estimated_clear_width_m: obstacleType === 'narrow_passage' ? 0.5 : 1.2,
    recommended_action:
      highRisk || profile.mobilityAid === 'wheelchair' ? 'reroute' : 'warning_only',
    confidence: 0.55,
    short_reason: note || 'Heuristic fallback used because no VLM key was configured.'
  });
}

export async function analyzeObstacleImage({ imageBase64, note, profile }) {
  if (!process.env.OPENAI_API_KEY || !imageBase64) {
    return heuristicObstacleAnalysis({ note, profile });
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const response = await openai.responses.parse({
      model: process.env.OPENAI_VLM_MODEL || 'gpt-4.1-mini',
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text:
                'You are a mobility-safety vision assistant for elderly pedestrian navigation in Singapore. Return JSON only.'
            }
          ]
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `Analyze this walkway image for elderly route planning. User mobility aid: ${profile.mobilityAid}. User note: ${note || 'none'}.`
            },
            {
              type: 'input_image',
              image_url: imageBase64,
              detail: 'high'
            }
          ]
        }
      ],
      text: {
        format: zodTextFormat(obstacleSchema, 'obstacle_analysis')
      }
    });

    return obstacleSchema.parse({
      ...response.output_parsed,
      analysis_mode: 'vision'
    });
  } catch (error) {
    console.warn('OpenAI VLM fallback triggered.', error);
    return heuristicObstacleAnalysis({ note, profile });
  }
}
