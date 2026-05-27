import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ✨ FIXED: Renamed 'body' to 'htmlContent' to match our new architecture
const translationSchema = {
  type: SchemaType.OBJECT,
  properties: {
    title: { type: SchemaType.STRING },
    description: { type: SchemaType.STRING },
    htmlContent: { type: SchemaType.STRING },
  },
  required: ['title', 'description', 'htmlContent'],
};

const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  generationConfig: {
    responseMimeType: 'application/json',
    responseSchema: translationSchema,
  },
});

const TARGET_LOCALES = [
  // 'ar',
  'de',
  // 'es',
  // 'fr',
  // 'he',
  // 'it',
  // 'ja',
  // 'pl',
  // 'pt',
  'ru',
  // 'tr',
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

        const enArticleJsonPath = path.join(EN_DIR, `${enArticle.slug}.json`);
        const enArticleHtmlPath = path.join(EN_DIR, `${enArticle.slug}.html`);

        const enArticleData = JSON.parse(
          fs.readFileSync(enArticleJsonPath, 'utf8'),
        );

        let enArticleHtml = '';
        if (fs.existsSync(enArticleHtmlPath)) {
          enArticleHtml = fs.readFileSync(enArticleHtmlPath, 'utf8');
        } else if (enArticleData.body) {
          // Fallback just in case the English version hasn't been split yet!
          enArticleHtml = enArticleData.body;
        }

        const targetLanguage =
          locale === 'pt' ? 'pt-BR (Brazilian Portuguese)' : locale;

        // ✨ FIXED: Updated prompt to reference htmlContent instead of body
        const prompt = `
          You are an expert translator. Translate the following content into: ${targetLanguage}.
          
          CRITICAL RULES:
          1. The 'htmlContent' string contains HTML. You MUST preserve every single HTML tag exactly as it is (e.g., <p>, <h2>, <div class="xyz">). ONLY translate the human-readable text between the tags.
          2. Ensure the output strictly follows the requested JSON schema.
          
          TITLE TO TRANSLATE:
          ${enArticleData.title}

          DESCRIPTION TO TRANSLATE:
          ${enArticleData.description}

          HTML CONTENT TO TRANSLATE:
          ${enArticleHtml}
        `;

        let success = false;
        let attempts = 0;
        const maxAttempts = 3;

        while (!success && attempts < maxAttempts) {
          try {
            attempts++;
            const result = await model.generateContent(prompt);

            const translatedFields = JSON.parse(result.response.text());

            // ✨ FIXED: Pulling from htmlContent instead of body
            const translatedHtmlPath = path.join(
              localeDir,
              `${enArticle.slug}.html`,
            );
            fs.writeFileSync(translatedHtmlPath, translatedFields.htmlContent);

            const finalArticleData = {
              ...enArticleData,
              title: translatedFields.title,
              description: translatedFields.description,
            };

            // Just in case the original English JSON still had the old 'body' property hanging around,
            // we delete it here so it doesn't pollute your clean translated JSON files!
            delete finalArticleData.body;

            const translatedJsonPath = path.join(
              localeDir,
              `${enArticle.slug}.json`,
            );
            fs.writeFileSync(
              translatedJsonPath,
              JSON.stringify(finalArticleData, null, 2),
            );

            localeCatalog.unshift({
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
