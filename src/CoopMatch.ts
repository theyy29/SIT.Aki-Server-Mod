import tsyringe = require("tsyringe");

import { LootItem } from "@spt-aki/models/spt/services/LootItem";
import type { ILogger } from "@spt-aki/models/spt/utils/ILogger";
import { SaveServer } from "@spt-aki/servers/SaveServer";
import { CoopConfig } from "./CoopConfig";
import { StayInTarkovMod } from "./StayInTarkovMod";
import { WebSocketHandler } from "./WebSocketHandler";

export enum CoopMatchStatus {
    Loading,
    InGame,
    Complete
}

export class CoopMatchEndSessionMessages {
    static HOST_SHUTDOWN_MESSAGE: "host-shutdown"
}

export class CoopMatch {

    ServerId: string;
    /** The time the match was created. Useful for clearing out old matches. */
    CreatedDateTime: Date = new Date();
    LastUpdateDateTime: Date = new Date();

    /** The state of the match. */
    State: any;
    /** The IP of the match. */
    Ip: string;
    /** The Port of the match. */
    Port: string;

    ExpectedNumberOfPlayers: number = 1;
    public ConnectedPlayers: string[] = [];

    // All characters in the game. Including AI
    public Characters: any[] = [];
    // LastDataByAccountId: Record<string, Record<string, Record<string, any>>> = {};

    LastDataByProfileId: Record<string, Record<string, Record<string, any>>> = {};

    // LastDataReceivedByAccountId: Record<string, number> = {};
    LastData: Record<string, Record<string, any>> = {};
    LastMoves: Record<string, any> = {};
    LastRotates: Record<string, any> = {};
    DamageArray: any[] = [];
    Status: CoopMatchStatus = CoopMatchStatus.Loading;
    Settings: any = {};
    Loot: any = {};
    Location: string;
    Time: string;
    WeatherSettings: any;
    SpawnPoint: any = { x: 0, y:0, z:0 }

    private SendLastDataInterval : NodeJS.Timer;
    private CheckStillRunningInterval: NodeJS.Timer;

    // A STATIC Dictonary of Coop Matches. The Key is the Account Id of the Player that created it
    public static CoopMatches: Record<string, CoopMatch> = {}; 
    public static AirdropLoot: LootItem[] = undefined;


    public static saveServer: SaveServer;

    public constructor(inData: any) {

        this.ServerId = inData.serverId;
        this.Status = CoopMatchStatus.Loading;
        this.CreatedDateTime = new Date(Date.now());
        this.LastUpdateDateTime = new Date(Date.now());

        if(inData.settings === undefined)
            return;

        this.Location = inData.settings.location;
        this.Time = inData.settings.timeVariant;
        this.WeatherSettings = inData.settings.timeAndWeatherSettings;

        if(CoopMatch.CoopMatches[inData.serverId] !== undefined) {
            delete CoopMatch.CoopMatches[inData.serverId];
        }

        let cm = this;
        // this.SendLastDataInterval = setInterval(() => {

        //     for(const key in cm.LastDataByAccountId) {
                
        //         if(key === undefined)
        //             continue;
                
        //         if(this.ConnectedPlayers[key] === undefined)
        //             continue;

        //         // Filter out old data
        //         // const LastDataByAccountId2: Record<string, Record<string, Record<string, any>>> = {}
        //         // for(const accountKey in this.LastDataByAccountId) {
        //         //     LastDataByAccountId2[accountKey] = {};
        //         //     const lastD = this.LastDataByAccountId[accountKey];
        //         //     // TODO: Continue this!
        //         // }

        //         // WebSocketHandler.Instance.sendToWebSockets(this.ConnectedPlayers, JSON.stringify(cm.LastDataByAccountId[key]));
        //     }

        // }, 1000);

        // This checks to see if the WebSockets can still be communicated with. If it cannot for any reason. The match/raid/session will close down.
        setTimeout(() => {
            this.CheckStillRunningInterval = setInterval(() => {

                if(!WebSocketHandler.Instance.areThereAnyWebSocketsOpen(this.ConnectedPlayers)) {
                    this.endSession(CoopMatchEndSessionMessages.HOST_SHUTDOWN_MESSAGE);
                }
    
            }, CoopConfig.Instance.webSocketTimeoutSeconds * 1000);
        }, CoopConfig.Instance.webSocketTimeoutCheckStartSeconds * 1000);

        
    }

    public ProcessData(info: any, logger: ILogger) {

        if(info === undefined)
            return;

        if(JSON.stringify(info).charAt(0) === "[") {

            for(var indexOfInfo in info) {
                const _info = info[indexOfInfo];
                this.ProcessData(_info, logger);
            }

            return;
        }

        // console.log(info);

        if (typeof(info) === "undefined") {

            return;
        }
        else if (typeof(info) === "string") {
            if (info.indexOf("?") !== -1) {
                // console.log(`coop match wants to process this info ${info}`)
                const infoMethod = info.split('?')[0];
                const infoData = info.split('?')[1];
                const newJObj = { m: infoMethod, data: infoData };
                this.ProcessData(newJObj, logger);
            }
            return;
        }

        if(info.m === "Ping" && info.t !== undefined && info.profileId !== undefined) {
            this.Ping(info.profileId, info.t);
            return;
        }

        if(info.m === "SpawnPointForCoop") {

            this.SpawnPoint.x = info.x;
            this.SpawnPoint.y = info.y;
            this.SpawnPoint.z = info.z;

            return;
        }

        if(info.profileId !== undefined && info.m === "PlayerLeft") {
            this.PlayerLeft(info.profileId);

            if(this.ConnectedPlayers.length == 0)
                this.endSession(CoopMatchEndSessionMessages.HOST_SHUTDOWN_MESSAGE);

            return;
        }

        // if(info.accountId !== undefined)
        //     this.PlayerJoined(info.accountId);

        if(info.profileId !== undefined)
            this.PlayerJoined(info.profileId);

        if(info.m === undefined) { 
            this.LastUpdateDateTime = new Date(Date.now());
            return;
        }
            
        // logger.info(`Update a Coop Server [${info.serverId}][${info.m}]`);

        if(info.m !== "PlayerSpawn") {
            // this.LastData[info.m] = info;

            if(this.LastDataByProfileId[info.profileId] === undefined)
                this.LastDataByProfileId[info.profileId] = {};

            this.LastDataByProfileId[info.profileId][info.m] = info;
        }
        
        // if(info.m == "Move") {
        //     // console.log(info);
        //     this.LastMoves[info.accountId] = info;
        // }
        // else
        
        if(info.m == "PlayerSpawn") {
            // console.log(info);
            let foundExistingPlayer = false;
            for(var c of this.Characters) {
                if(info.profileId == c.profileId) {
                    foundExistingPlayer = true;
                    break;
                }
            }
            if(!foundExistingPlayer)
                this.Characters.push(info);
        }
        
        if(info.m == "Kill") {
            for(var c of this.Characters) {
                if (info.profileId == c.profileId) {
                    c.isDead = true;
                    break;
                }
            }
        }

        this.LastUpdateDateTime = new Date(Date.now());

        WebSocketHandler.Instance.sendToWebSockets(this.ConnectedPlayers, JSON.stringify(info));
    }

    public UpdateStatus(inStatus: CoopMatchStatus) {
        this.Status = inStatus;
    }

    public PlayerJoined(profileId: string) {
        if(this.ConnectedPlayers.findIndex(x => x == profileId) === -1) {
            this.ConnectedPlayers.push(profileId);
            console.log(`${this.ServerId}: ${profileId} has joined`);
        }
    }

    public PlayerLeft(profileId: string) {
        this.ConnectedPlayers = this.ConnectedPlayers.filter(x => x != profileId);
        console.log(`${this.ServerId}: ${profileId} has left`);
        // If the Server Player has died or escaped, end the session
        if(this.ServerId == profileId) {
            this.endSession(CoopMatchEndSessionMessages.HOST_SHUTDOWN_MESSAGE);
        }
    }

    public Ping(profileId: string, timestamp: string) {
        WebSocketHandler.Instance.sendToWebSockets([profileId], JSON.stringify({ pong: timestamp }));
    }

    public endSession(reason: string) {
        console.log(`COOP SESSION ${this.ServerId} HAS BEEN ENDED`);
        WebSocketHandler.Instance.sendToWebSockets(this.ConnectedPlayers, JSON.stringify({ "endSession": true, reason: reason }));

        this.Status = CoopMatchStatus.Complete;
        clearInterval(this.SendLastDataInterval);
        clearInterval(this.CheckStillRunningInterval);

        delete CoopMatch.CoopMatches[this.ServerId];

        // Clear out Location Data after match has ended
        StayInTarkovMod.Instance.locationData = {};
    }

    public static routeHandler(container: tsyringe.DependencyContainer) {

        // const dynamicRouterModService = container.resolve<DynamicRouterModService>("DynamicRouterModService");
        // const staticRouterModService = container.resolve<StaticRouterModService>("StaticRouterModService");

        //  staticRouterModService.registerStaticRouter(
        //     "MyStaticModRouterSITConfig",
        //     [
        //         {
        //             url: "/coop/server/getAllForLocation",
        //             action: (url, info: any, sessionId: string, output) => {
        //                 console.log(info);
        //                 const matches : CoopMatch[] = [];
        //                 for(let itemKey in CoopMatch.CoopMatches) {
        //                     matches.push(CoopMatch.CoopMatches[itemKey]);
        //                 }
        //                 output = JSON.stringify(matches);
        //                 return output;
        //             }
        //         }
        //     ]
        //     ,"aki"
        // )

    }

    
}