"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
exports.__esModule = true;
var APP_ID = "";
function setAppId(id) {
    if (id) {
        APP_ID = id;
    }
}
exports.setAppId = setAppId;
function updateIntercom(event, settings) {
    if (event === void 0) { event = "update"; }
    if (settings === void 0) { settings = null; }
    if (typeof window !== "undefined" && window.Intercom) {
        window.Intercom("update", settings);
    }
}
exports.updateIntercom = updateIntercom;
function createIntercomSSR(appId) {
    if (appId === void 0) { appId = APP_ID; }
    return __awaiter(this, void 0, void 0, function () {
        var dataSource, scriptBody, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 3, , 4]);
                    return [4, fetch("https://widget.intercom.io/widget/" + appId)];
                case 1:
                    dataSource = _a.sent();
                    return [4, dataSource.text()];
                case 2:
                    scriptBody = _a.sent();
                    return [2, "<script type=\"text/javascript\" async=\"true\">" + scriptBody + "</script>"];
                case 3:
                    error_1 = _a.sent();
                    console.error(error_1);
                    return [2, error_1];
                case 4: return [2];
            }
        });
    });
}
exports.createIntercomSSR = createIntercomSSR;
function loadIntercom(_a) {
    var _b = _a.appId, appId = _b === void 0 ? APP_ID : _b, _c = _a.ssr, ssr = _c === void 0 ? false : _c, callBack = _a.callBack, _d = _a.delay, delay = _d === void 0 ? 0 : _d, _e = _a.email, email = _e === void 0 ? null : _e, name = _a.name, _f = _a.initWindow, initWindow = _f === void 0 ? true : _f, _g = _a.scriptType, scriptType = _g === void 0 ? "async" : _g, _h = _a.scriptInitDelay, scriptInitDelay = _h === void 0 ? 0 : _h, extra = __rest(_a, ["appId", "ssr", "callBack", "delay", "email", "name", "initWindow", "scriptType", "scriptInitDelay"]);
    setAppId(appId);
    if (ssr) {
        return createIntercomSSR(appId);
    }
    else if (typeof window !== "undefined") {
        if (typeof window.Intercom === "function") {
            updateIntercom("reattach_activator");
            updateIntercom("update", window.intercomSettings);
        }
        else if (typeof document !== "undefined") {
            var intercomeBase = function () {
                intercomeBase.c(arguments);
            };
            intercomeBase.q = [];
            intercomeBase.c = function (args) {
                intercomeBase.q.push(args);
            };
            window.Intercom = intercomeBase;
            var loadScript = function () {
                var intercomLoaded = document.querySelector("script[src=\"" + ("https://widget.intercom.io/widget/" + appId) + "\"]");
                if (!intercomLoaded) {
                    var intercomScript = document.createElement("script");
                    intercomScript.type = "text/javascript";
                    if (scriptType) {
                        intercomScript[scriptType] = true;
                    }
                    intercomScript.src = "https://widget.intercom.io/widget/" + appId;
                    var initialScript = document.getElementsByTagName("script")[0];
                    if (initialScript && initialScript.parentNode) {
                        initialScript.parentNode.insertBefore(intercomScript, initialScript);
                    }
                    if (initWindow) {
                        var intercomProps_1 = Object.assign({}, {
                            email: email || null,
                            appId: appId,
                            name: name
                        }, extra);
                        if (delay && typeof delay === "number") {
                            setTimeout(function () { return initIntercomWindow(intercomProps_1); }, delay);
                        }
                        else {
                            initIntercomWindow(intercomProps_1);
                        }
                    }
                }
                else {
                    console.log("intercom script already inserted");
                }
                typeof callBack === "function" && callBack();
            };
            if (scriptInitDelay && typeof scriptInitDelay === "number") {
                setTimeout(loadScript, scriptInitDelay);
            }
            else {
                loadScript();
            }
        }
        else {
            console.warn("intercom failed to load");
        }
    }
}
exports.loadIntercom = loadIntercom;
function initIntercomWindow(_a) {
    var _b = _a.appId, appId = _b === void 0 ? APP_ID : _b, otherProps = __rest(_a, ["appId"]);
    var intercomProps = Object.assign({}, {
        app_id: appId
    }, otherProps);
    if (typeof window !== "undefined" && window.Intercom) {
        if (window.intercomSettings && !window.intercomSettings.app_id) {
            window.intercomSettings = intercomProps;
        }
        window.Intercom("boot", intercomProps);
    }
}
exports.initIntercomWindow = initIntercomWindow;
function shutdownIntercom() {
    if (typeof window !== "undefined" && window.Intercom) {
        window.Intercom("shutdown");
        delete window.Intercom;
        delete window.intercomSettings;
    }
}
exports.shutdownIntercom = shutdownIntercom;
//# sourceMappingURL=index.js.map