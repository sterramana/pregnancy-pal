const functions = require("firebase-functions");
const {defineSecret} = require("firebase-functions/params");

// Define the Gemini API key as a secret
const geminiApiKey = defineSecret("GEMINI_API_KEY");

exports.callgemini = functions.runWith({secrets: [geminiApiKey]}).https.onCall(async (data, context) => {
  // Check if the user is authenticated
  if (!context.auth) {
    throw new functions.https.HttpsError(
        "unauthenticated",
        "The function must be called while authenticated.",
    );
  }

  const userQuery = data.query;
  if (!userQuery) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "The function must be called with a 'query' argument.",
    );
  }

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-preview-0514:generateContent?key=${geminiApiKey.value()}`;
  const systemPrompt = `You are Pregnancy Pal, a cautious AI assistant. Summarize web search results about safety for pregnant women. Rules: 1. Base summary ONLY on provided Google Search results. 2. Be clear, balanced, and easy to understand. 3. If sources conflict, state it. 4. Use neutral language. 5. **Do NOT give direct medical advice.** 6. Keep summary to 1-2 concise paragraphs.`;
  const payload = {
    contents: [{parts: [{text: userQuery}]}],
    tools: [{"google_search": {}}],
    systemInstruction: {parts: [{text: systemPrompt}]},
  };

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("API Error Response:", errorBody);
      throw new functions.https.HttpsError(
          "internal",
          `API call failed with status: ${response.status}`,
      );
    }

    const result = await response.json();
    const candidate = result.candidates?.[0];
    if (!candidate?.content?.parts?.[0]?.text) {
      // It's possible the response is valid but has no text, e.g. for a tool call.
      // For this app, we expect text, so we'll treat it as an issue.
      console.warn("No text found in Gemini response:", JSON.stringify(result, null, 2));
      // Return a user-friendly message instead of throwing an error
      return {summary: "The AI analysis completed, but no summary could be generated. This might happen for very broad or unanswerable queries. Please try a more specific search.", sources: []};
    }

    const text = candidate.content.parts[0].text;
    let sources = [];
    const groundingMetadata = candidate.groundingMetadata;
    if (groundingMetadata?.groundingAttributions) {
      sources = groundingMetadata.groundingAttributions
          .map((attr) => ({uri: attr.web?.uri, title: attr.web?.title}))
          .filter((s) => s.uri && s.title);
    }
    // Remove duplicate sources
    const uniqueSources = Array.from(
        new Map(sources.map((item) => [item["uri"], item])).values(),
    );

    return {summary: text, sources: uniqueSources};
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError(
        "internal",
        "Failed to call Gemini API.",
    );
  }
});
