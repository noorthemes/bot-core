import * as BotBuilder from 'botbuilder';
import * as logger from 'logops';

import { LanguageDetector, Logger, ServerLogger, Normalizer, Audio, Slack, DirectLinePrompts } from './middlewares';
import { PluginLoader } from './loader';

export interface BotSettings extends BotBuilder.IUniversalBotSettings {
    models: BotBuilder.ILuisModelMap;
    plugins: string[];
}

export class Bot extends BotBuilder.UniversalBot {
    private loader: PluginLoader;

    constructor(settings: BotSettings) {
        super(null, settings);

        this.loader = new PluginLoader(settings.plugins);

        // the one and only dialog our bot will have
        this.dialog('/', this.createIntentDialog());

        // middlewares
        this.use(BotBuilder.Middleware.dialogVersion({
            version: 1.0,
            message: 'Conversation restarted by a main update',
            resetCommand: /^reset/i
        }));

        let middlewares = [
            Audio, DirectLinePrompts, ServerLogger, Normalizer, LanguageDetector, Logger, Slack
        ];
        middlewares.forEach((middleware) => this.use(middleware));

        this.on('error', err => logger.error(err));

        this.endConversationAction(
            'cancel',
            'core.cancel',
            { matches: /(^cancel$)|(^never mind$)|(^forget it$)/i }
        );
    }

    private createIntentDialog(): BotBuilder.IntentDialog {
        let luisRecognizers = this.initializeLanguageRecognizers();

        let intentDialog = new BotBuilder.IntentDialog({
            recognizers: luisRecognizers
        });

        let libraries = this.loader.getLibraries();
        libraries.forEach(library => this.library(library));

        intentDialog.onDefault((session: BotBuilder.Session, args: any, next: Function) => {
            logger.debug('Find library for intent [%s]', args.intent);

            let dialogName = this.findDialog(args.intent, libraries);

            if (dialogName) {
                logger.debug({ args }, 'Starting library dialog [%s]', dialogName);
                session.beginDialog(dialogName, args);
            } else {
                logger.warn({ intent: args.intent }, 'Unhandled intent');
                let msg = createkUnhandledMessageResponse(session, args);
                session.endDialog(msg);
            }
        });

        return intentDialog;
    }

    private findDialog(intent: string, libraries: BotBuilder.Library[]): string {
        let dialogName: string;

        libraries.some(library => {
            if (this.library('*').findDialog(library.name, intent)) {
                dialogName = `${library.name}:${intent}`;
            }
            return !!dialogName;
        });

        return dialogName;
    }

    private initializeLanguageRecognizers(): BotBuilder.IIntentRecognizer[] {
        let modelMap = this.get('models') as BotBuilder.ILuisModelMap;

        if (!modelMap) {
            logger.error('No LUIS models defined');
            return [];
        }

        return Object.keys(modelMap).map(key => {
            let model = modelMap[key];
            if (!model) {
                logger.error('LUIS model %s is undefined. Skip.', key);
                return;
            }

            logger.info('Load LUIS model %s', key);
            return new BotBuilder.LuisRecognizer(modelMap[key]);
        }).filter(recognizer => !!recognizer);
    }
}

function createkUnhandledMessageResponse(session: BotBuilder.Session, args: any): BotBuilder.Message {
    let text = session.gettext('core.default') || 'I do not understand';
    return new BotBuilder.Message(session).text(text);
}
