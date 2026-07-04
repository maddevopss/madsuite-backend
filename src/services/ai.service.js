const db = require("../../db");
const logger = require("../config/logger");
const projectDetectionService = require("./projectDetection.service");
const OpenAI = require("openai");
const aiToolsService = require("./aiTools.service");

let openaiInstance = null;

function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  if (!openaiInstance) {
    openaiInstance = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    logger.info("✅ OpenAI initialized");
  }

  return openaiInstance;
}

function isAIEnabled() {
  return !!process.env.OPENAI_API_KEY;
}
/**
 * Génère des suggestions de feuilles de temps basées sur les logs d'activité d'une journée
 */
async function generateTimesheetSuggestions({ organisationId, userId, targetDate }) {
  try {
    // Récupérer les activités de la journée
    const result = await db.query(
      `
      SELECT id, app_name, window_title, duration_seconds, project_suggestion_id, captured_at
      FROM activity_logs
      WHERE utilisateur_id = $1
        AND organisation_id = $2
        AND DATE(captured_at) = $3
        AND is_idle = false
      ORDER BY captured_at ASC
      `,
      [userId, organisationId, targetDate]
    );

    const logs = result.rows;
    if (logs.length === 0) return [];

    // On regroupe par projet
    const projectGroups = {};
    const unassignedLogs = [];

    // Essayer d'assigner tous les logs qui n'ont pas de suggestion via notre service local
    for (const log of logs) {
      let projectId = log.project_suggestion_id;

      if (!projectId) {
        const suggestion = await projectDetectionService.suggestProject({
          appName: log.app_name,
          windowTitle: log.window_title,
          organisationId
        });

        if (suggestion && suggestion.suggestion) {
          projectId = suggestion.suggestion.id;
        }
      }

      if (projectId) {
        if (!projectGroups[projectId]) {
          projectGroups[projectId] = {
            duration: 0,
            apps: new Set(),
            titles: new Set(),
            firstSeen: log.captured_at,
            lastSeen: log.captured_at
          };
        }

        projectGroups[projectId].duration += (log.duration_seconds || 0);
        projectGroups[projectId].apps.add(log.app_name);
        if (log.window_title) projectGroups[projectId].titles.add(log.window_title);

        if (new Date(log.captured_at) < new Date(projectGroups[projectId].firstSeen)) {
          projectGroups[projectId].firstSeen = log.captured_at;
        }
        if (new Date(log.captured_at) > new Date(projectGroups[projectId].lastSeen)) {
          projectGroups[projectId].lastSeen = log.captured_at;
        }
      } else {
        unassignedLogs.push(log);
      }
    }

    // Convertir les groupes en suggestions de timesheet
    const suggestions = [];

    // Récupérer les noms des projets
    if (Object.keys(projectGroups).length > 0) {
      const projectIds = Object.keys(projectGroups);
      const projRes = await db.query(
        `SELECT id, nom, taux_horaire FROM projets WHERE id = ANY($1)`,
        [projectIds]
      );

      const projectDetails = {};
      projRes.rows.forEach(p => projectDetails[p.id] = p);

      for (const [projectId, data] of Object.entries(projectGroups)) {
        if (data.duration < 60) continue; // Ignorer les trucs de moins d'une minute

        const project = projectDetails[projectId];
        if (!project) continue;

        let description = "";
        let isAiGenerated = false;

        const appsList = Array.from(data.apps).slice(0, 10).join(", ");
        const titleSample = Array.from(data.titles).slice(0, 20).join(" | ");

        const openai = getOpenAI();

        if (openai) {
          try {
            const completion = await openai.chat.completions.create({
              model: "gpt-4o-mini", // Use mini for speed and cost
              messages: [
                {
                  role: "system",
                  content: "Tu es un assistant virtuel. À partir de cette liste d'applications utilisées et de titres de fenêtres d'un utilisateur, rédige une phrase professionnelle et très concise (max 15 mots) résumant le travail accompli. Cette phrase sera utilisée comme description dans une feuille de temps. Ne mets pas de guillemets."
                },
                {
                  role: "user",
                  content: `Projet concerné: ${project.nom}\nApplications: ${appsList}\nTitres de fenêtres: ${titleSample}`
                }
              ],
              temperature: 0.3,
            });
            description = completion.choices[0].message.content.trim();
            isAiGenerated = true;
          } catch (aiError) {
            logger.error("Erreur avec OpenAI pour générer la description", aiError);
            // Fallback
            description = `Détection automatique via IA locale.\nApplications: ${appsList}`;
          }
        } else {
          // Fallback if no API key
          description = `Détection automatique via heuristique.\nApplications: ${appsList}\nDétails: ${titleSample}`;
        }

        suggestions.push({
          projet_id: parseInt(projectId, 10),
          projet_nom: project.nom,
          description,
          start_time: data.firstSeen,
          end_time: data.lastSeen,
          duration_seconds: data.duration,
          taux_horaire: project.taux_horaire,
          confidence: "high",
          is_ai_generated: isAiGenerated
        });
      }
    }

    return suggestions;
  } catch (error) {
    logger.error("Erreur lors de la génération des suggestions AI", error);
    throw error;
  }
}

/**
 * Interroge l'assistant IA (Copilot) avec un historique de messages.
 */
async function askCopilot(messages, organisationId, userId) {
  const openai = getOpenAI();

  if (!openai) {
    return "Le service IA n'est pas configuré actuellement.";
  }

  try {
    const systemPrompt = {
      role: "system",
      content: `Tu es MADSuite Copilot, l'assistant IA officiel de la plateforme SaaS MADSuite.
Ton rôle est d'aider les pigistes et les PME à comprendre leurs données de facturation et leurs activités.
Par défaut, tu es en mode lecture seule : tu peux analyser, expliquer, rechercher et proposer des brouillons ou des étapes, mais tu ne dois pas promettre qu'une action d'écriture a été exécutée sauf si un outil autorisé confirme explicitement le succès.
Pour les actions sensibles comme créer un client, créer un projet, créer une facture ou envoyer une relance, présente plutôt un résumé clair à valider par l'utilisateur.
Ne donne pas de conseil médical, ne pose pas de diagnostic et ne prétends pas mesurer un état mental réel.
Sois concis, professionnel et toujours en français par défaut.
Utilise le formatage Markdown pour tes réponses.`
    };

    const currentMessages = [systemPrompt, ...messages];
    const tools = aiToolsService.getToolsSchema();

    let completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Cost efficient but very capable
      messages: currentMessages,
      temperature: 0.5,
      max_tokens: 1000,
      tools: tools,
      tool_choice: "auto",
    }, { timeout: 30000 }); // 30s timeout pour éviter les requêtes bloquées indéfiniment

    let responseMessage = completion.choices[0].message;

    // Boucle d'exécution d'outils (jusqu'à 5 itérations max pour éviter les boucles infinies)
    let maxIterations = 5;

    while (responseMessage.tool_calls && maxIterations > 0) {
      maxIterations--;
      currentMessages.push(responseMessage);

      for (const toolCall of responseMessage.tool_calls) {
        const toolResult = await aiToolsService.executeToolCall(toolCall, organisationId);
        
        currentMessages.push({
          tool_call_id: toolCall.id,
          role: "tool",
          name: toolCall.function.name,
          content: JSON.stringify(toolResult)
        });
      }

      // Rappel d'OpenAI avec les résultats des outils
      completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: currentMessages,
        temperature: 0.5,
        max_tokens: 1000,
        tools: tools,
        tool_choice: "auto",
      });

      responseMessage = completion.choices[0].message;
    }

    return responseMessage.content ? responseMessage.content.trim() : "Opération terminée.";
  } catch (error) {
    logger.error("Erreur lors de la requête au Copilot", error);
    throw error;
  }
}

async function generateProjectSummary({ projectId, organisationId }) {
  try {
    const openai = getOpenAI();
    const projectRes = await db.query(
      `SELECT * FROM projets WHERE id = $1 AND (organisation_id = $2 OR organisation_id IS NULL)`,
      [projectId, organisationId]
    );
    const project = projectRes.rows[0];
    if (!project) {
      const err = new Error("Projet introuvable");
      err.statusCode = 404;
      throw err;
    }

    const entriesRes = await db.query(
      `SELECT description, duration_seconds FROM time_entries 
       WHERE projet_id = $1 AND (organisation_id = $2 OR organisation_id IS NULL) AND end_time IS NOT NULL
       ORDER BY created_at DESC LIMIT 50`,
      [projectId, organisationId]
    );
    const entries = entriesRes.rows;

    const statsRes = await db.query(
      `SELECT 
         COALESCE(SUM(duration_seconds), 0) / 3600.0 AS total_hours,
         COUNT(*) as total_entries
       FROM time_entries WHERE projet_id = $1 AND (organisation_id = $2 OR organisation_id IS NULL)`,
      [projectId, organisationId]
    );
    const stats = statsRes.rows[0];

    const budget = project.budget || 0;
    const totalHours = parseFloat(stats.total_hours).toFixed(1);
    const descriptions = entries.map(e => e.description).filter(Boolean).slice(0, 30).join(" | ");

    if (openai) {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Tu es un chef de projet IA. Analyse les données fournies pour ce projet et génère un résumé très concis (3-4 phrases). Parle de l'état d'avancement, des tâches récentes accomplies et de la santé budgétaire (si budget est défini). Rédige d'un ton professionnel et factuel."
          },
          {
            role: "user",
            content: `Projet: ${project.nom}\nBudget: ${budget > 0 ? budget + '$' : 'Non défini'}\nTaux horaire: ${project.taux_horaire || 0}$\nHeures totales enregistrées: ${totalHours}h\nTâches récentes: ${descriptions}`
          }
        ],
        temperature: 0.3,
      });
      return { summary: completion.choices[0].message.content.trim(), is_ai_generated: true };
    } else {
      return { 
        summary: `L'IA n'est pas activée. Le projet ${project.nom} a cumulé ${totalHours} heures. Tâches récentes : ${descriptions.slice(0, 100)}...`,
        is_ai_generated: false 
      };
    }
  } catch (error) {
    logger.error("Erreur lors de la génération du résumé de projet AI", error);
    throw error;
  }
}

async function categorizeActivitiesBatch({ activities, organisationId }) {
  const openai = getOpenAI();

  if (!openai || activities.length === 0) {
    return [];
  }

  try {
    const list = activities.map((a) => `ID ${a.id}: App: ${a.app_name}, Titre: ${a.window_title}`).join("\n");
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Tu es un expert en productivité. Je vais te donner une liste d'activités (fenêtres ouvertes par l'utilisateur).
Pour chaque ID, donne une catégorie la plus pertinente (ex: "Développement", "Communication", "Recherche", "Administration", "Design", "Autre") et précise si c'est productif (true/false).
Réponds STRICTEMENT sous format JSON:
{ "results": [ { "id": ID_NUMERIQUE, "category": "Nom de la catégorie", "is_productive": true } ] }`
        },
        {
          role: "user",
          content: list
        }
      ],
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    const responseText = completion.choices[0].message.content;
    const parsed = JSON.parse(responseText);
    
    const results = parsed.results || [];
    for (const res of results) {
       // P2-8 fix: Suppression de OR organisation_id IS NULL — ne modifier que les enregistrements
       // appartenant strictement à l'organisation courante.
       await db.query(
         `UPDATE activity_logs SET activity_category = $1, confidence_score = 85 WHERE id = $2 AND organisation_id = $3`,
         [res.category, res.id, organisationId]
       );
    }
    
    return results;
  } catch (error) {
    logger.error("Erreur catégorisation batch", error);
    throw error;
  }
}

async function generateBrainDumpTasks({ prompt }) {
  const openai = getOpenAI();

  if (!openai) {
    throw new Error("L'IA n'est pas activée");
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Tu es un assistant de productivité non médical.
L'utilisateur va te donner une liste d'idées, de tâches ou de notes en vrac.
Ton rôle est de transformer ce texte en une suite séquentielle de MICRO-ACTIONS extrêmement claires, simples et actionnables.
N'établis aucun diagnostic, n'interprète pas l'état mental de l'utilisateur et ne formule aucune recommandation médicale.
Estime un temps raisonnable en minutes pour chaque micro-action. Ne dépasse pas 30 minutes par action (divise si nécessaire).
Réponds STRICTEMENT sous format JSON:
{ "tasks": [ { "title": "Nom de l'action très court", "duration_minutes": 15 } ] }`
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3,
      response_format: { type: "json_object" }
    });

    const responseText = completion.choices[0].message.content;
    const parsed = JSON.parse(responseText);
    
    return parsed.tasks || [];
  } catch (error) {
    logger.error("Erreur generateBrainDumpTasks", error);
    throw error;
  }
}

module.exports = {
  getOpenAI,
  isAIEnabled,
  generateTimesheetSuggestions,
  askCopilot,
  generateProjectSummary,
  categorizeActivitiesBatch,
  generateBrainDumpTasks,
};
