import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ✨ NEW: We force Gemini to use Structured Outputs (JSON Schema)
// This strictly controls how the AI replies so it cannot break the formatting!
const translationSchema = {
  type: SchemaType.OBJECT,
  properties: {
    title: { type: SchemaType.STRING },
    description: { type: SchemaType.STRING },
    body: { type: SchemaType.STRING },
  },
  required: ['title', 'description', 'body'],
};

const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  generationConfig: {
    responseMimeType: 'application/json',
    responseSchema: translationSchema,
  },
});

const TARGET_LOCALES = [
  'ar',
  'de',
  'es',
  'fr',
  'he',
  'it',
  // 'ja',
  'pl',
  'pt',
  'ru',
  'tr',
];
const BLOG_DIR = path.join(process.cwd(), 'blog', 'posts');
const EN_DIR = path.join(BLOG_DIR, 'en');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function translateBlogPosts() {
  console.log('📖 Reading English catalog...');
  const enCatalogPath = path.join(EN_DIR, 'catalog.json');
  const enCatalog = JSON.parse(fs.readFileSync(enCatalogPath, 'utf8'));

  for (const locale of TARGET_LOCALES) {
    console.log(
      `\n🌍 Checking missing translations for: ${locale.toUpperCase()}`,
    );

    const localeDir = path.join(BLOG_DIR, locale);
    const localeCatalogPath = path.join(localeDir, 'catalog.json');

    if (!fs.existsSync(localeDir)) {
      fs.mkdirSync(localeDir, { recursive: true });
    }

    let localeCatalog = [];
    if (fs.existsSync(localeCatalogPath)) {
      localeCatalog = JSON.parse(fs.readFileSync(localeCatalogPath, 'utf8'));
    }

    for (const enArticle of enCatalog) {
      const isAlreadyTranslated = localeCatalog.some(
        (item) => item.slug === enArticle.slug,
      );

      if (!isAlreadyTranslated) {
        console.log(`   ⚡ Translating "${enArticle.slug}" into ${locale}...`);

        const enArticlePath = path.join(EN_DIR, `${enArticle.slug}.json`);
        const enArticleData = JSON.parse(
          fs.readFileSync(enArticlePath, 'utf8'),
        );

        const targetLanguage =
          locale === 'pt' ? 'pt-BR (Brazilian Portuguese)' : locale;

        // ✨ NEW: We only send the specific text fields that need translating
        // We do NOT send the whole JSON object anymore!
        const prompt = `
          You are an expert translator. Translate the following content into: ${targetLanguage}.
          
          CRITICAL RULES:
          1. The 'body' text contains HTML. You MUST preserve every single HTML tag exactly as it is (e.g., <p>, <h2>). ONLY translate the human-readable text between the tags.
          2. Ensure the output strictly follows the requested JSON schema.
          
          TITLE TO TRANSLATE:
          ${enArticleData.title}

          DESCRIPTION TO TRANSLATE:
          ${enArticleData.description}

          BODY HTML TO TRANSLATE:
          ${enArticleData.body}
        `;

        let success = false;
        let attempts = 0;
        const maxAttempts = 3;

        while (!success && attempts < maxAttempts) {
          try {
            attempts++;
            const result = await model.generateContent(prompt);

            // This response is now guaranteed to match our schema
            const translatedFields = JSON.parse(result.response.text());

            // ✨ NEW: We safely rebuild the final JSON object ourselves!
            const finalArticleData = {
              ...enArticleData, // Keep all original untranslated fields (slug, date, img)
              title: translatedFields.title, // Inject the translated title
              description: translatedFields.description, // Inject the translated description
              body: translatedFields.body, // Inject the translated body
            };

            const translatedArticlePath = path.join(
              localeDir,
              `${enArticle.slug}.json`,
            );
            fs.writeFileSync(
              translatedArticlePath,
              JSON.stringify(finalArticleData, null, 2),
            );

            localeCatalog.push({
              slug: finalArticleData.slug,
              title: finalArticleData.title,
              description: finalArticleData.description,
              img: finalArticleData.img,
              datePublished: finalArticleData.datePublished,
            });

            fs.writeFileSync(
              localeCatalogPath,
              JSON.stringify(localeCatalog, null, 2),
            );
            console.log(`   ✅ Success!`);

            success = true;
            await sleep(500);
          } catch (error) {
            if (
              error.message.includes('503') ||
              error.message.includes('429') ||
              error.message.includes('JSON') ||
              error.name === 'SyntaxError'
            ) {
              console.warn(
                `   ⚠️ AI Error or Server busy (Attempt ${attempts}/${maxAttempts}). Retrying...`,
              );

              if (attempts >= maxAttempts) {
                console.error(
                  `   ❌ FATAL: Failed after ${maxAttempts} attempts. Halting.`,
                );
                process.exit(1);
              }
              await sleep(5000);
            } else {
              console.error(
                `   ❌ FATAL ERROR: Failed to translate ${enArticle.slug}:`,
                error.message,
              );
              process.exit(1);
            }
          }
        }
      } else {
        console.log(`   ⏭️ Skipped "${enArticle.slug}" (Already translated)`);
      }
    }
  }
  console.log(
    '\n🎉 All translations are up to date and finished at lightning speed!',
  );
}

translateBlogPosts();
