import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';

const galleryDocumentPath = '/gallery-owned.txt';
const galleryDocumentText = 'Synthetic gallery document owned bytes';
const galleryRetryImagePath = '/gallery-retry.svg';
const galleryOfficePath = '/gallery-office-original';
const galleryOfficeOrigin = 'https://view.officeapps.live.com';
const galleryOfficeFrameText = 'Synthetic Office iframe';
const frontDownloadSvg =
    '<svg xmlns="http://www.w3.org/2000/svg"><title>Front</title></svg>';
const rearDownloadSvg =
    '<svg xmlns="http://www.w3.org/2000/svg"><title>Rear</title></svg>';

const hostSource = (format, nativeConfirm) => `
${
    format === 'esm'
        ? `import {createElement as h, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AttachmentField} from '@miniextensions/sdk/react/attachment';
import {AttachmentGallery, AttachmentSlider} from '@miniextensions/sdk/react/attachment-slider';
import {AttachmentPreview, AttachmentSliderActions, AttachmentSliderBody, AttachmentSliderNavigation, AttachmentSliderThumbnailRail, AttachmentTileOpenButton, ThemeBoundary, useAttachmentDownload, useAttachmentGalleryNavigation} from '@miniextensions/sdk/react';`
        : `const {createElement:h, useRef, useState}=require('react');
const {createRoot}=require('react-dom/client');
const {AttachmentField}=require('@miniextensions/sdk/react/attachment');
const {AttachmentGallery, AttachmentSlider}=require('@miniextensions/sdk/react/attachment-slider');
const {AttachmentPreview, AttachmentSliderActions, AttachmentSliderBody, AttachmentSliderNavigation, AttachmentSliderThumbnailRail, AttachmentTileOpenButton, ThemeBoundary, useAttachmentDownload, useAttachmentGalleryNavigation}=require('@miniextensions/sdk/react');`
}
${
    nativeConfirm
        ? format === 'esm'
            ? "import {Dialog as NativeDialog} from 'native-dialog';"
            : "const {Dialog:NativeDialog}=require('native-dialog');"
        : 'const NativeDialog=null;'
}
const first={filename:'Vue avant',url:'/front.svg',type:'image/svg+xml'};
const second={filename:'Vue arrière',url:'/rear.svg',type:'image/svg+xml'};
const calls={selection:[],save:0,upload:0,delete:0,fetch:0};
const tileOpens=[];
const downloads={pending:[],finished:0};
let bodySelections=0;
const headerCalls={deletes:0, reads:[], errors:0, escapes:0};
const headerListeners=new Set();
let headerCurrent=true;
const headerOwner={isCurrent:()=>headerCurrent,subscribe(listener){
    headerListeners.add(listener);
    return ()=>headerListeners.delete(listener);
}};
const downloadListeners=new Set();
const downloadOwner={token:0,isCurrent:()=>true,subscribe(listener){
    downloadListeners.add(listener);
    return ()=>downloadListeners.delete(listener);
}};
const galleryDocumentPath=${JSON.stringify(galleryDocumentPath)};
const galleryRetryImagePath=${JSON.stringify(galleryRetryImagePath)};
const galleryOfficeUri=location.origin+${JSON.stringify(galleryOfficePath)};
const localGalleryFetch=window.fetch.bind(window);
window.fetch=(input,init)=>{
    if (input===galleryOfficeUri && init?.method==='HEAD' && init.credentials==='omit' && init.signal instanceof AbortSignal) {
        galleryStats.officeHeads++;
        return localGalleryFetch(input,init);
    }
    calls.fetch++;
    return Promise.reject(Error('Unexpected I/O'));
};
function Host(){
    const [rows,setRows]=useState([first,second]);
    const [selectedIndex,setSelectedIndex]=useState(0);
    const [acceptsIntent,setAcceptsIntent]=useState(false);
    const [collectionOwner,setCollectionOwner]=useState('initial');
    const [publication,setPublication]=useState('initial');
    const [tile,setTile]=useState({resourceKey:'initial',label:'Pièce jointe'});
    const [bodyRows,setBodyRows]=useState([
        {...first,id:'front',thumbnailUrl:first.url},
        {...second,id:'rear',thumbnailUrl:second.url},
    ]);
    const bodyNav=useAttachmentGalleryNavigation(bodyRows);
    const bodyRail=useRef(null);
    const [header,setHeader]=useState('closed');
    function replace(owner){
        setRows([first,second]);
        setSelectedIndex(0);
        setCollectionOwner(owner);
        setPublication(owner);
    }
    window.sliderProbe={calls,downloads,setSelectedIndex,setAcceptsIntent,
        tileOpens,publishTile(resourceKey,label){setTile({resourceKey,label});},
        openBody(){bodyNav.handleAttachmentThumbnailClick(0);},
        shrinkBody(){setBodyRows((items)=>items.slice(0,1));},
        emptyBody(){setBodyRows([]);},
        bodySelections:()=>bodySelections,
        showHeader:()=>setHeader('active'),
        closeHeader:()=>setHeader('closed'),
        revokeHeader:()=>{headerCurrent=false;},
        settleHeader(){
            for (const notify of [...headerListeners]) notify();
            headerCalls.reads[0].resolve(new Response('retired header bytes'));
        },
        headerCalls:()=>({deletes:headerCalls.deletes,reads:headerCalls.reads.map(({url})=>url),errors:headerCalls.errors,escapes:headerCalls.escapes}),
        replace,
        rotateDownloadOwner(){downloadOwner.token++;for(const listener of [...downloadListeners])listener();},
        reset(owner){calls.selection.length=0;replace(owner);},
        remap(marker){setRows((items)=>items.map((item)=>({...item})));setPublication(marker);},
        duplicates(){setRows([first,{...second,filename:first.filename}]);setPublication('duplicates');},
        shrink(){setRows([first]);},
        retire(){setRows([]);setCollectionOwner(null);setPublication('retired');}};
    const selected=rows[selectedIndex];
    const download=useAttachmentDownload({
        url:selected?.url??null,
        filename:selected?.filename+'.svg',
        identity:collectionOwner+':'+selectedIndex,
        owner:downloadOwner,
        read(url){return new Promise((resolve)=>downloads.pending.push({url,resolve}));},
    });
    return h('form',{'data-publication':publication,onSubmit(event){event.preventDefault();calls.save++;}},
        h(AttachmentSliderNavigation,{
            rows,selectedIndex,collectionOwner,labels:{navigation:'Pièces jointes',previous:'Précédent',next:'Suivant'},
            onSelect(index){calls.selection.push(index);if(acceptsIntent)setSelectedIndex(index);},
        },selected&&h(AttachmentPreview,{attachment:selected}),h('input',{'aria-label':'Détail'})),
        collectionOwner&&h(AttachmentSliderThumbnailRail,{
            rows:rows.map((row,index)=>({
                key:collectionOwner+':'+index,
                filename:row.filename,
                thumbnailUrl:index===0?row.url:null,
            })),
            selectedIndex,
            onSelect(index){calls.selection.push(index);if(acceptsIntent)setSelectedIndex(index);},
        }),
        selected&&h('button',{type:'button','data-download':true,disabled:download.progress!=null,
            onClick(){void download.start().then(()=>downloads.finished++);}},
            download.progress==null?'Télécharger la pièce jointe':download.progress+'%'),
        h('button',{type:'submit'},'Enregistrer'),
        h('button',{type:'button',onClick(){calls.upload++;}},'Téléverser'),
        h('button',{type:'button',onClick(){calls.delete++;}},'Supprimer'),
        h('div',{className:'attachment-tile-proof'},h(AttachmentTileOpenButton,{
            ...tile,onOpen(){tileOpens.push(tile.label);},
        })),
        header==='active'&&h('section',{'aria-label':'Commandes de la pièce jointe'},
            h(AttachmentSliderActions,{
                attachment:second,downloadIdentity:'selected-row',
                labels:{delete:'Effacer',download:'Télécharger',open:'Ouvrir'},
                canDownload:true,canOpen:true,presentationOwner:headerOwner,
                onDelete(){headerCalls.deletes++;},
                readDownload(url){return new Promise((resolve)=>headerCalls.reads.push({url,resolve}));},
                onDownloadError(){headerCalls.errors++;},
            })),
        bodyNav.navigationOwner&&h('div',{
            role:'dialog','aria-label':'Visionneuse','data-body-owner':bodyNav.navigationOwner,
            className:'attachment-body-proof',
        },h(AttachmentSliderBody,{
            rows:bodyRows,
            currentIndex:bodyNav.currentSliderIndex,
            setCurrentIndex(next){bodySelections++;bodyNav.setCurrentSliderIndex(next);},
            navigationOwner:bodyNav.navigationOwner,
            thumbnailRailRef:bodyRail,
            labels:{attachments:'Aperçu des pièces jointes',previewNotAvailable:'Aucun aperçu',previous:'Précédent',next:'Suivant'},
        })));
}

const fullscreenStats={dismissals:[],deleteRequests:0,confirmed:0,confirmDismissals:0,selections:0};
const fullscreenRows=[
    {...first,id:'fullscreen-front',thumbnailUrl:first.url},
    {...second,id:'fullscreen-rear',thumbnailUrl:second.url},
];
const fullscreenDownloadRows=fullscreenRows.map((row)=>({...row,filename:row.filename+'.svg'}));
const fullscreenDownloadReads=[];
const fullscreenLabels={
    attachments:'Pièces jointes plein écran',previewNotAvailable:'Aucun aperçu',
    previous:'Précédent',next:'Suivant',delete:'Effacer la pièce jointe',
    download:'Télécharger la pièce jointe',open:'Ouvrir la pièce jointe',
    close:'Fermer la visionneuse',
};
function FullscreenHost(){
    const [mode,setMode]=useState(null);
    const [index,setIndex]=useState(0);
    const [downloadRows,setDownloadRows]=useState(fullscreenDownloadRows);
    const [intercomOpen,setIntercomOpen]=useState(false);
    const [confirm,setConfirm]=useState(false);
    const cancel=useRef(null);
    function open(nextMode){setIndex(0);setMode(nextMode);}
    window.fullscreenProbe={
        intercom:setIntercomOpen,
        stats:()=>({...fullscreenStats,dismissals:[...fullscreenStats.dismissals]}),
        downloadReads:()=>[...fullscreenDownloadReads],
        selectDownloadRow:setIndex,
        renameDownload(){setDownloadRows((rows)=>[rows[0],{...rows[1],filename:'Vue arrière actualisée.svg'}]);},
    };
    return h('section',{className:'attachment-fullscreen-host'},
        h('button',{type:'button',onClick:()=>open('standalone')},'Ouvrir le plein écran'),
        h('button',{type:'button',onClick:()=>open('download')},'Ouvrir les fichiers à télécharger'),
        NativeDialog&&h('button',{type:'button',onClick:()=>open('native')},'Ouvrir avec confirmation native'),
        mode&&h(AttachmentSlider,{
            rows:mode==='download'?downloadRows:fullscreenRows,currentIndex:index,
            setCurrentIndex(next){fullscreenStats.selections++;setIndex(next);},
            navigationOwner:mode,downloadIdentity:index,
            canDownload:true,canOpen:true,
            readDownload(url){
                if (mode!=='download') {calls.fetch++;throw Error('Unexpected fullscreen download');}
                fullscreenDownloadReads.push(url);
                return Promise.resolve(new Response(url===first.url?${JSON.stringify(frontDownloadSvg)}:${JSON.stringify(rearDownloadSvg)}));
            },
            onDelete:mode==='download'?undefined:()=>{fullscreenStats.deleteRequests++;if(mode==='native')setConfirm(true);},
            onDismiss(){fullscreenStats.dismissals.push(mode);setMode(null);},
            covered:confirm,intercomOpen,labels:fullscreenLabels,
        }),
        confirm&&NativeDialog&&h(NativeDialog,{
            open:true,initialFocus:cancel,className:'attachment-native-confirm-proof',
            onClose(){fullscreenStats.confirmDismissals++;setConfirm(false);},
        },h(NativeDialog.Panel,{className:'attachment-native-confirm-panel'},
            h(NativeDialog.Title,null,'Confirmer la suppression'),
            h('button',{type:'button',onClick(){
                fullscreenStats.confirmed++;setConfirm(false);
            }},'Confirmer'),
            h('button',{type:'button',ref:cancel,onClick(){setConfirm(false);}},'Annuler'),
        )),
    );
}
window.addEventListener('keydown',(event)=>{
    if(event.key==='Escape'&&!event.defaultPrevented) headerCalls.escapes++;
});

const galleryStats={submits:0,removals:[],annotations:[],documentReads:0,officeHeads:0,downloads:0};
const galleryPhoto={
    ...first,id:'gallery-photo',filename:'Image galerie',resourceUrl:'/front.svg',
    imageSources:['/front.svg'],icon:'document',annotationAllowed:true,removeTestId:'gallery-remove-front',
    canOpenInSlider:true,canDownloadInSlider:true,
};
const galleryRows=[
    galleryPhoto,
    {...galleryPhoto,id:'gallery-second',filename:'Image arrière',url:'/rear.svg',resourceUrl:'/rear.svg',imageSources:['/rear.svg'],annotationAllowed:false,removeTestId:undefined},
    {id:'gallery-play',filename:'Vidéo galerie',url:'/rear.svg',resourceUrl:'/rear.svg#video',imageSources:[],icon:'play',type:'video/mp4',canOpenInSlider:false,canDownloadInSlider:false},
    {id:'gallery-file',filename:'Fichier galerie',url:'/rear.svg',resourceUrl:'/rear.svg#file',imageSources:[],icon:'document',type:'application/octet-stream',canOpenInSlider:false,canDownloadInSlider:false},
    {...galleryPhoto,id:'gallery-fifth',filename:'Image cinq',resourceUrl:'/front.svg#five',annotationAllowed:false,removeTestId:undefined},
    {...galleryPhoto,id:'gallery-sixth',filename:'Image six',resourceUrl:'/front.svg#six',annotationAllowed:false,removeTestId:undefined},
];
const galleryRetryRow={
    ...galleryPhoto,id:'gallery-retry',filename:'Image à réessayer',
    resourceUrl:'/front.svg#retry',imageSources:[galleryRetryImagePath],
    annotationAllowed:false,removeTestId:undefined,
};
const galleryDocumentRow={
    id:'gallery-doc',filename:'Document de la galerie',url:galleryDocumentPath,
    resourceUrl:galleryDocumentPath,imageSources:[],icon:'document',type:'text/plain',canOpenInSlider:false,canDownloadInSlider:false,
    document:{
        uri:location.origin+galleryDocumentPath,
        options:{source:{kind:'uri',mimeType:'text/plain',revision:'gallery-doc'}},
        async readLocal(signal){
            if (signal.aborted) throw signal.reason;
            galleryStats.documentReads++;
            const response=await localGalleryFetch(galleryDocumentPath,{
                method:'GET',credentials:'omit',redirect:'error',signal,
            });
            if (!response.ok) throw Error('Unable to read synthetic gallery document');
            return response;
        },
    },
};
const galleryOfficeRow={
    id:'gallery-office',filename:'Document Office opaque',url:galleryOfficeUri,
    resourceUrl:galleryOfficeUri,imageSources:[],icon:'document',type:'application/octet-stream',
    canOpenInSlider:false,canDownloadInSlider:false,
    document:{uri:galleryOfficeUri,options:{source:{kind:'uri'}},legacyOfficePreview:true},
};
const galleryRemovalOwner={};
const galleryLabels={
    ...fullscreenLabels,remove:'Retirer la tuile',retry:'Réessayer la tuile',annotate:'Annoter la tuile',
};
function GalleryHost(){
    const [config,setConfig]=useState(null);
    window.galleryProbe={
        configure:setConfig,
        stats:()=>({
            ...galleryStats,removals:[...galleryStats.removals],annotations:[...galleryStats.annotations],
        }),
    };
    if (!config) return null;
    const {layout,columns,fit,showNames,scene}=config;
    const rows=scene==='retry'?[galleryRetryRow]:scene==='document'?[galleryDocumentRow]:
        scene==='office'?[galleryOfficeRow]:galleryRows;
    const actions=scene==='actions';
    return h('form',{
        id:'attachment-gallery-proof','data-gallery-scene':scene,'data-gallery-fit':fit,
        'data-gallery-columns':columns,'data-gallery-names':showNames,'data-gallery-layout':layout,
        onSubmit(event){event.preventDefault();galleryStats.submits++;},
    },h('div',{className:layout==='grid'?'attachment-gallery-grid-frame':undefined},
        h(AttachmentGallery,{
            rows,layout,columns,fit,showNames,prepareImagesForPrint:false,
            labels:galleryLabels,showOpen:scene!=='document'&&scene!=='office',tileTestId:'gallery-proof-tile',
            formRemovalOwner:galleryRemovalOwner,
            canRemoveFromTile:(index)=>actions&&index===0,
            onRemove:actions?(index)=>galleryStats.removals.push(index):undefined,
            onAnnotate:actions?(index)=>galleryStats.annotations.push(index):undefined,
            readDownload(){galleryStats.downloads++;throw Error('Unexpected gallery download');},
        })
    ));
}


const fieldStats={files:[],urls:[],helps:0,submits:0,cancels:0,confirmEscapes:0,confirmed:0,uploadEscapes:0};
const fieldUrlOwner={token:'owned-attachment-url',isCurrent:()=>true};
window.addEventListener('keydown',(event)=>{
    if (event.key==='Escape' && !event.defaultPrevented &&
        document.querySelector('.mx-sdk-attachment-upload-dialog[aria-modal]')) fieldStats.uploadEscapes++;
});
function AttachmentFieldHost(){
    const [config,setConfig]=useState(null);
    const [percentage,setPercentage]=useState(null);
    const [intercomOpen,setIntercomOpen]=useState(false);
    const [confirm,setConfirm]=useState(false);
    const confirmCancel=useRef(null);
    window.attachmentFieldProbe={
        configure:setConfig,update:setPercentage,intercom:setIntercomOpen,
        stats:()=>({...fieldStats,files:[...fieldStats.files],urls:[...fieldStats.urls]}),
    };
    if (!config) return null;
    const {scene,legacy}=config;
    const input=scene==='device' ? {kind:'device',props:{
        id:'local-attachment-field-device',
        form:'attachment-field-proof',
        accept:'text/plain',
        describedBy:'attachment-device-proof-description',
        labels:{chooseFiles:'Choisir un fichier pour la preuve',dragAndDrop:'Déposer le fichier ici'},
        onFiles(files){fieldStats.files.push(files.map(({name,type,size})=>({name,type,size})));},
    }} : scene==='url' ? {kind:'url',props:{
        id:'local-attachment-field-url',owner:fieldUrlOwner,
        labels:{url:'Adresse de la pièce jointe',add:'Ajouter l’adresse',invalidUrl:'Adresse refusée',appendRefused:'Réessayer l’adresse'},
        appendCurrent(attachment){fieldStats.urls.push(attachment);return true;},
    }} : undefined;
    const error=scene==='error' ? {
        message:'Permission locale requise. https://fixture.invalid/permission',
        help:{label:'Aide sur la permission',onClick(){fieldStats.helps++;}},
    } : undefined;
    const upload=percentage==null ? undefined : {
        percentage,
        labels:{uploading:'Transfert synthétique en cours',cancel:'Annuler le transfert'},
        covered:confirm,intercomOpen,
        onCancel(){
            fieldStats.cancels++;
            if (legacy) setConfirm(true);
            else setPercentage(null);
        },
    };
    return h(ThemeBoundary,{theme:'purple'},h('form',{
        id:'attachment-field-proof','data-field-scene':scene,'data-field-legacy':legacy===true,
        onSubmit(event){event.preventDefault();fieldStats.submits++;},
    },
        scene==='device'&&h('p',{id:'attachment-device-proof-description'},'Document texte seulement'),
        h(AttachmentField,{
            input,error,upload,
            emptyLabel:scene==='readonly'||scene==='readonly-rows'?'Aucune pièce jointe':undefined,
            gallery:{
                rows:scene==='readonly-rows'?[galleryPhoto]:[],layout:'thumbnail',columns:3,
                fit:'cover',showNames:true,showOpen:false,labels:galleryLabels,tileTestId:'field-proof-tile',
                readDownload(){calls.fetch++;throw Error('Unexpected attachment field download');},
            },
        }),
        scene==='upload'&&h('button',{type:'button',onClick:()=>setPercentage(37)},'Démarrer le transfert synthétique'),
        confirm&&NativeDialog&&h(NativeDialog,{
            open:true,initialFocus:confirmCancel,className:'attachment-native-confirm-proof',
            onClose(){fieldStats.confirmEscapes++;setConfirm(false);},
        },h(NativeDialog.Panel,{className:'attachment-native-confirm-panel'},
            h(NativeDialog.Title,null,'Confirmer l’annulation du transfert'),
            h('button',{type:'button',onClick(){fieldStats.confirmed++;setConfirm(false);}},'Confirmer l’annulation'),
            h('button',{type:'button',ref:confirmCancel,onClick:()=>setConfirm(false)},'Poursuivre le transfert'),
        )),
    ));
}
createRoot(document.querySelector('main')).render(h('div',null,h(Host),h(GalleryHost),h(AttachmentFieldHost),h(FullscreenHost)));
`;

const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>';

export async function checkAttachmentSliderNavigationBrowser({
    browser,
    consumer,
    evidence,
    nativeConfirm = false,
}) {
    evidence.formats = {};
    const staleGestures = [];
    const require = createRequire(join(consumer, 'package.json'));
    if (nativeConfirm) {
        assert.equal(require('react').version, '18.3.1');
        const manifest = JSON.parse(
            readFileSync(
                join(
                    dirname(require.resolve('native-dialog')),
                    '..',
                    'package.json'
                ),
                'utf8'
            )
        );
        assert.equal(manifest.name, '@headlessui/react');
        assert.equal(manifest.version, '1.7.2');
    }
    const styles = readFileSync(
        require.resolve('@miniextensions/sdk/react/attachment-preview.css')
    );
    const fieldStyleNames = [
        'attachment-device-input.css',
        'attachment-url-input.css',
        'attachment-upload-progress.css',
        'theme.css',
    ];
    const fieldStyles = fieldStyleNames.map((name) => [
        '/' + name,
        [
            'text/css',
            readFileSync(require.resolve('@miniextensions/sdk/react/' + name)),
        ],
    ]);
    const fieldStyleLinks = fieldStyleNames
        .map((name) => '<link rel="stylesheet" href="/' + name + '">')
        .join('');
    for (const format of ['esm', 'cjs']) {
        const entry = `attachment-slider-navigation-proof.${format === 'esm' ? 'mjs' : 'cjs'}`;
        writeFileSync(join(consumer, entry), hostSource(format, nativeConfirm));
        const bundle = await build({
            absWorkingDir: consumer,
            entryPoints: [entry],
            bundle: true,
            platform: 'browser',
            format: 'esm',
            write: false,
            metafile: true,
        });
        await assertBrowserInputs(bundle.metafile, consumer);
        assert(
            Object.keys(bundle.metafile.inputs).some((name) =>
                name.endsWith('/react/AttachmentSliderThumbnailRail.js')
            ),
            'The installed Slider Thumbnail Rail must be bundled'
        );
        assert(
            Object.keys(bundle.metafile.inputs).some((name) =>
                name.endsWith('/react/AttachmentTileOpenButton.js')
            ),
            'The installed Attachment Tile Open Button must be bundled'
        );
        assert(
            Object.keys(bundle.metafile.inputs).some((name) =>
                name.endsWith('/react/AttachmentSliderBody.js')
            ),
            'The installed Attachment Slider Body must be bundled'
        );
        assert(
            Object.keys(bundle.metafile.inputs).some((name) =>
                name.endsWith('/react/AttachmentSliderActions.js')
            ),
            'The installed Attachment Slider Actions must be bundled'
        );
        assert(
            Object.keys(bundle.metafile.inputs).some((name) =>
                name.endsWith('/react/AttachmentSlider.js')
            ),
            'The installed fullscreen Attachment Slider must be bundled'
        );
        assert(
            Object.keys(bundle.metafile.inputs).some((name) =>
                name.endsWith('/react/AttachmentGallery.js')
            ),
            'The installed Attachment Gallery must be bundled'
        );
        assert(
            Object.keys(bundle.metafile.inputs).some((name) =>
                name.endsWith('/react/document-preview/DocumentThumbnail.js')
            ),
            'The Attachment Gallery must reuse the installed Document Thumbnail'
        );
        for (const leaf of ['attachment', 'AttachmentUploadDialog']) {
            assert(
                Object.keys(bundle.metafile.inputs).some((name) =>
                    name.endsWith('/react/' + leaf + '.js')
                ),
                'The installed Attachment Field must bundle ' + leaf
            );
        }
        const assets = new Map([
            [
                '/',
                [
                    'text/html',
                    '<!doctype html><html lang="fr"><meta charset="utf-8"><link rel="stylesheet" href="/attachment-preview.css">' +
                        fieldStyleLinks +
                        '<link rel="stylesheet" href="/host.css"><main></main><script type="module" src="/host.js"></script></html>',
                ],
            ],
            ['/host.js', ['text/javascript', bundle.outputFiles[0].text]],
            [
                '/host.css',
                [
                    'text/css',
                    '.attachment-tile-proof{position:relative;width:96px;height:48px}.attachment-body-proof{width:min(640px,100vw - 32px);height:360px}.attachment-fullscreen-host{box-sizing:border-box;min-height:180vh;padding-top:180px}.attachment-fullscreen-scroll-probe{height:1200px}.attachment-native-confirm-proof{position:fixed;inset:0;z-index:110;display:grid;place-items:center;background:#0008}.attachment-native-confirm-panel{background:white;padding:24px}#attachment-gallery-proof{width:min(620px,100vw - 32px)}.attachment-gallery-grid-frame{height:48px}#attachment-field-proof{width:min(620px,100vw - 32px)}#attachment-field-proof[data-field-scene="upload"]{padding-top:160px}',
                ],
            ],
            ['/attachment-preview.css', ['text/css', styles]],
            ...fieldStyles,
            ['/favicon.ico', ['image/svg+xml', svg]],
            ['/front.svg', ['image/svg+xml', svg]],
            ['/rear.svg', ['image/svg+xml', svg]],
            [
                galleryDocumentPath,
                ['text/plain; charset=utf-8', galleryDocumentText],
            ],
            [galleryRetryImagePath, ['image/svg+xml', svg]],
        ]);
        const unexpectedRequests = [];
        const pageErrors = [];
        const galleryRequests = {
            document: 0,
            retry: 0,
            officeHeads: 0,
            officeOriginalGets: 0,
            officeFrames: 0,
        };
        const server = createServer((request, response) => {
            if (
                request.method === 'HEAD' &&
                request.url === galleryOfficePath
            ) {
                galleryRequests.officeHeads++;
                response
                    .writeHead(200, {
                        'content-type': 'application/octet-stream',
                        'cache-control': 'no-store',
                    })
                    .end();
                return;
            }
            const asset = request.method === 'GET' && assets.get(request.url);
            if (!asset) {
                unexpectedRequests.push(request.url);
                response.writeHead(404).end();
                return;
            }
            const documentRead = request.url === galleryDocumentPath;
            const retryRead = request.url === galleryRetryImagePath;
            if (documentRead) galleryRequests.document++;
            const faultyImage = retryRead && ++galleryRequests.retry === 1;
            response
                .writeHead(200, {
                    'content-type': asset[0],
                    'content-security-policy':
                        "default-src 'self'; connect-src 'self'; frame-src 'self' https://view.officeapps.live.com; form-action 'none'",
                    ...(documentRead || retryRead
                        ? { 'cache-control': 'no-store' }
                        : {}),
                })
                .end(faultyImage ? '<invalid synthetic image>' : asset[1]);
        });
        let context;
        try {
            await new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(0, '127.0.0.1', resolve);
            });
            const origin = `http://127.0.0.1:${server.address().port}`;
            const officeUri = origin + galleryOfficePath;
            const officeEmbed =
                galleryOfficeOrigin +
                '/op/embed.aspx?src=' +
                encodeURIComponent(officeUri);
            context = await browser.newContext({ serviceWorkers: 'block' });
            await context.route('**/*', (route) => {
                const request = route.request();
                const url = new URL(request.url());
                if (url.href === officeUri) {
                    if (request.method() === 'HEAD') return route.continue();
                    if (request.method() === 'GET')
                        galleryRequests.officeOriginalGets++;
                }
                if (
                    url.href === officeEmbed &&
                    request.method() === 'GET' &&
                    request.isNavigationRequest() &&
                    request.resourceType() === 'document'
                ) {
                    galleryRequests.officeFrames++;
                    return route.fulfill({
                        status: 200,
                        contentType: 'text/html',
                        body:
                            '<!doctype html><title>Office fixture</title><p>' +
                            galleryOfficeFrameText +
                            '</p>',
                    });
                }
                const isDocumentRead =
                    request.resourceType() === 'fetch' ||
                    request.resourceType() === 'xhr';
                if (
                    url.origin === origin &&
                    assets.has(url.pathname) &&
                    (!isDocumentRead ||
                        (url.pathname === galleryDocumentPath &&
                            request.method() === 'GET' &&
                            url.search === ''))
                )
                    return route.continue();
                unexpectedRequests.push(url.href);
                return route.abort();
            });
            const page = await context.newPage();
            page.on('pageerror', (error) => pageErrors.push(error.message));
            await page.goto(origin);
            const navigation = page.getByRole('group', {
                name: 'Pièces jointes',
            });
            const previous = navigation.getByRole('button', {
                name: 'Précédent',
            });
            const next = navigation.getByRole('button', { name: 'Suivant' });
            const filename = navigation.locator('[aria-live]');
            const preview = navigation.locator('img');
            const probe = () => page.evaluate(() => window.sliderProbe.calls);
            const committed = (marker) =>
                page.locator(`form[data-publication="${marker}"]`).waitFor();
            await next.waitFor();
            assert.equal(await filename.innerText(), 'Vue avant');
            assert.equal(await previous.getAttribute('aria-disabled'), 'true');
            await next.click();
            assert.deepEqual((await probe()).selection, [1]);
            assert.equal(await filename.innerText(), 'Vue avant');
            await page.evaluate(() => {
                window.sliderProbe.setAcceptsIntent(true);
                window.sliderProbe.setSelectedIndex(1);
            });
            await navigation
                .getByText('Vue arrière', { exact: true })
                .waitFor();
            assert.equal(await next.getAttribute('aria-disabled'), 'true');
            await next.press('ArrowRight');
            assert.deepEqual((await probe()).selection, [1]);
            await next.press('ArrowLeft');
            await navigation.getByText('Vue avant', { exact: true }).waitFor();
            const detail = navigation.getByRole('textbox', { name: 'Détail' });
            await detail.press('ArrowRight');
            assert.deepEqual((await probe()).selection, [1, 0]);
            await page.evaluate(() => window.sliderProbe.duplicates());
            await committed('duplicates');
            await next.press('Enter');
            await navigation.locator('img[src="/rear.svg"]').waitFor();
            assert.equal(await filename.innerText(), 'Vue avant');
            assert.equal(await preview.getAttribute('src'), '/rear.svg');
            await page.evaluate(() => window.sliderProbe.shrink());
            await navigation.waitFor({ state: 'detached' });
            await page.evaluate(() => window.sliderProbe.retire());
            await page.keyboard.press('ArrowLeft');
            const calls = await probe();
            assert.deepEqual(calls, {
                selection: [1, 0, 1],
                save: 0,
                upload: 0,
                delete: 0,
                fetch: 0,
            });

            async function heldGesture(input, replaceOwner) {
                const initial = `${input}-initial`;
                const successor = `${input}-successor`;
                await page.evaluate(
                    (owner) => window.sliderProbe.reset(owner),
                    initial
                );
                await committed(initial);
                await next.waitFor();
                if (input === 'pointer') {
                    const position = await next.boundingBox();
                    assert.ok(position);
                    await page.mouse.move(
                        position.x + position.width / 2,
                        position.y + position.height / 2
                    );
                    await page.mouse.down();
                } else {
                    await next.focus();
                    await page.keyboard.down('Space');
                }
                const originalButton = await next.elementHandle();
                assert.ok(originalButton);
                await page.evaluate(
                    ({ marker, replace }) => {
                        if (replace) window.sliderProbe.replace(marker);
                        else window.sliderProbe.remap(marker);
                    },
                    { marker: successor, replace: replaceOwner }
                );
                await committed(successor);
                const sameControl = await next.evaluate(
                    (button, original) => button === original,
                    originalButton
                );
                await originalButton.dispose();
                if (input === 'pointer') await page.mouse.up();
                else await page.keyboard.up('Space');
                const held = (await probe()).selection;
                if (!replaceOwner) {
                    assert.deepEqual(held, [1]);
                    return { held, sameControl };
                }
                if (held.length)
                    staleGestures.push(
                        `${format}/${input}: ${JSON.stringify(held)}`
                    );
                await page.evaluate(() =>
                    window.sliderProbe.setSelectedIndex(0)
                );
                await navigation
                    .getByText('Vue avant', { exact: true })
                    .waitFor();
                if (input === 'pointer') await next.click();
                else await next.press('Space');
                const fresh = (await probe()).selection.slice(held.length);
                assert.deepEqual(fresh, [1]);
                return { held, fresh, sameControl };
            }

            const gestures = {
                replacedPointer: await heldGesture('pointer', true),
                replacedSpace: await heldGesture('space', true),
                remappedPointer: await heldGesture('pointer', false),
                remappedSpace: await heldGesture('space', false),
            };
            const tileOpen = await checkTileOpen(page);
            assert.equal((await probe()).save, 0);
            await page.evaluate(() =>
                window.sliderProbe.reset('thumbnail-rail')
            );
            await committed('thumbnail-rail');
            const rail = page.locator('.mx-sdk-attachment-thumbnail-rail');
            const frontTile = rail.getByRole('button', { name: 'Vue avant' });
            const rearTile = rail.getByRole('button', { name: 'Vue arrière' });
            await frontTile.waitFor();
            assert.equal(await frontTile.getAttribute('data-selected'), 'true');
            assert.equal(
                await rail.locator('img').getAttribute('src'),
                '/front.svg'
            );
            assert.equal(
                await rail.locator('svg').getAttribute('aria-hidden'),
                'true'
            );
            const railBounds = await rail.boundingBox();
            const tileBounds = await frontTile.boundingBox();
            const rearBounds = await rearTile.boundingBox();
            assert.ok(railBounds && tileBounds && rearBounds);
            const railGeometry = {
                height: railBounds.height,
                tile: [tileBounds.width, tileBounds.height],
                gap: rearBounds.x - tileBounds.x - tileBounds.width,
            };
            assert.deepEqual(railGeometry, {
                height: 44,
                tile: [40, 40],
                gap: 8,
            });
            await rearTile.click();
            await rail
                .locator('button[data-selected="true"]')
                .getByText('Vue arrière')
                .waitFor({ state: 'attached' });
            await frontTile.press('Space');
            await rail
                .locator('button[data-selected="true"]')
                .getByText('Vue avant')
                .waitFor({ state: 'attached' });
            const railSelection = (await probe()).selection;
            assert.deepEqual(railSelection, [1, 0]);
            const { selection: _selection, ...otherCalls } = await probe();
            assert.deepEqual(otherCalls, {
                save: 0,
                upload: 0,
                delete: 0,
                fetch: 0,
            });
            const download = page.locator('[data-download]');
            const saves = [];
            page.on('download', (file) => saves.push(file));
            const finish = (index, value) =>
                page.evaluate(
                    ({ index, value }) =>
                        window.sliderProbe.downloads.pending[index].resolve(
                            new Response(value, {
                                headers: {
                                    'Content-Length': String(value.length),
                                },
                            })
                        ),
                    { index, value }
                );
            const settled = (count) =>
                page.waitForFunction(
                    (expected) =>
                        window.sliderProbe.downloads.finished === expected,
                    count
                );
            const saveCurrent = async (index, contents) => {
                const [saved] = await Promise.all([
                    page.waitForEvent('download'),
                    finish(index, contents),
                ]);
                try {
                    assert.equal(saved.suggestedFilename(), 'Vue arrière.svg');
                    assert.equal(
                        readFileSync(await saved.path(), 'utf8'),
                        contents
                    );
                    return saved.suggestedFilename();
                } finally {
                    await saved.delete();
                }
            };
            await download.click();
            assert.equal(await download.innerText(), '0%');
            await rearTile.press('Space');
            await rail
                .locator('button[data-selected="true"]')
                .getByText('Vue arrière')
                .waitFor({ state: 'attached' });
            assert.equal(await download.isEnabled(), true);
            await download.click();
            await finish(0, 'old');
            await settled(1);
            assert.equal(await download.innerText(), '0%');
            assert.equal(saves.length, 0);
            const downloadFilename = await saveCurrent(1, 'current');
            await settled(2);

            await download.click();
            assert.equal(await download.innerText(), '0%');
            await page.evaluate(() => window.sliderProbe.rotateDownloadOwner());
            await page
                .getByRole('button', { name: 'Télécharger la pièce jointe' })
                .waitFor();
            assert.equal(await download.isEnabled(), true);
            await download.click();
            await finish(2, 'retired-generation');
            await settled(3);
            assert.equal(await download.innerText(), '0%');
            assert.equal(saves.length, 1);
            await saveCurrent(3, 'successor-generation');
            await settled(4);

            await download.click();
            await page.evaluate(() => window.sliderProbe.retire());
            await committed('retired');
            await finish(4, 'dismissed');
            await settled(5);
            assert.equal(saves.length, 2);
            const readUrls = await page.evaluate(() =>
                window.sliderProbe.downloads.pending.map(({ url }) => url)
            );
            assert.deepEqual(readUrls, [
                '/front.svg',
                '/rear.svg',
                '/rear.svg',
                '/rear.svg',
                '/rear.svg',
            ]);
            const sliderBody = await checkSliderBody(page);
            const sliderActions = await checkSliderActions(page);
            const fullscreenSlider = await checkFullscreenSlider(
                page,
                nativeConfirm
            );
            const attachmentGallery = await checkAttachmentGallery(
                page,
                galleryRequests
            );
            const attachmentField = await checkAttachmentField(
                page,
                nativeConfirm
            );
            assert.equal(saves.length, 2);
            const { selection: _bodySelection, ...bodyOwnerCalls } =
                await probe();
            assert.deepEqual(bodyOwnerCalls, otherCalls);
            assert.deepEqual(unexpectedRequests, []);
            assert.deepEqual(pageErrors, []);
            evidence.formats[format] = {
                selection: calls.selection,
                ownerCalls: calls,
                gestures,
                tileOpen,
                sliderBody,
                sliderActions,
                fullscreenSlider,
                attachmentGallery,
                attachmentField,
                thumbnailRail: {
                    geometry: railGeometry,
                    selection: railSelection,
                },
                download: {
                    readUrls,
                    filename: downloadFilename,
                    saves: saves.length,
                    notifiedOwnerRotation: true,
                },
                unexpectedRequests,
                pageErrors,
            };
            evidence.formats[format].fullscreenDownloadPress =
                await checkFullscreenDownloadPress(page);
            assert.deepEqual(unexpectedRequests, []);
            assert.deepEqual(pageErrors, []);
        } finally {
            try {
                await context?.close();
            } finally {
                server.closeAllConnections();
                if (server.listening)
                    await new Promise((resolve, reject) => {
                        server.close((error) =>
                            error ? reject(error) : resolve()
                        );
                    });
            }
        }
    }
    assert.deepEqual(
        staleGestures,
        [],
        'A retired owner’s held gesture selected in its successor'
    );
}

async function checkAttachmentField(page, nativeConfirm) {
    const form = page.locator('#attachment-field-proof');
    const field = form.locator('.mx-sdk-attachment-field');
    const probe = () =>
        page.evaluate(() => window.attachmentFieldProbe.stats());
    async function configure(scene, legacy = false) {
        await page.evaluate(
            (config) => window.attachmentFieldProbe.configure(config),
            { scene, legacy }
        );
        await form
            .and(
                page.locator(
                    '[data-field-scene="' +
                        scene +
                        '"][data-field-legacy="' +
                        legacy +
                        '"]'
                )
            )
            .waitFor();
    }

    await page.evaluate(() => window.scrollTo(0, 0));
    await configure('device');
    const picker = field.locator('input[type="file"]');
    assert.equal(
        await picker.getAttribute('id'),
        'local-attachment-field-device'
    );
    assert.equal(await picker.getAttribute('form'), 'attachment-field-proof');
    assert.equal(await picker.getAttribute('accept'), 'text/plain');
    assert.equal(
        await picker.getAttribute('aria-label'),
        'Choisir un fichier pour la preuve'
    );
    assert.equal(
        await picker.getAttribute('aria-describedby'),
        'attachment-device-proof-description'
    );
    assert.equal(await picker.getAttribute('multiple'), '');
    assert.equal(
        await field
            .locator('.mx-sdk-attachment-device')
            .evaluate((node) => getComputedStyle(node).borderTopStyle),
        'dashed'
    );
    await picker.setInputFiles({
        name: 'owned-upload.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('file'),
    });
    const files = [[{ name: 'owned-upload.txt', type: 'text/plain', size: 4 }]];
    assert.deepEqual((await probe()).files, files);

    await configure('url');
    assert.equal(await picker.count(), 0);
    const url = field.getByRole('textbox', {
        name: 'Adresse de la pièce jointe',
    });
    const add = field.getByRole('button', { name: 'Ajouter l’adresse' });
    assert.equal(await url.getAttribute('inputmode'), 'url');
    assert.equal(await add.getAttribute('type'), 'button');
    await url.fill('ftp://fixture.invalid/refused.txt');
    await url.press('Enter');
    await field.getByText('Adresse refusée', { exact: true }).waitFor();
    assert.deepEqual((await probe()).urls, []);
    await url.fill('  https://fixture.invalid/owned%20document.txt  ');
    await url.press('Enter');
    assert.equal(await url.inputValue(), '');
    assert.equal(
        await field.getByText('Adresse refusée', { exact: true }).count(),
        0
    );
    const urls = [
        {
            id: null,
            url: 'https://fixture.invalid/owned%20document.txt',
            filename: 'owned document.txt',
        },
    ];
    assert.deepEqual((await probe()).urls, urls);

    await configure('readonly');
    const empty = field.getByTestId('no-value-test-id');
    assert.equal(await empty.textContent(), 'Aucune pièce jointe');
    assert.equal(await field.locator('input,button').count(), 0);
    await configure('readonly-rows');
    assert.equal(await empty.count(), 0);
    assert.equal(await field.getByTestId('field-proof-tile').count(), 1);
    assert.equal(await field.locator('input,button').count(), 0);

    await configure('error');
    const error = field.getByRole('alert');
    const message = error.locator('[aria-label="error-message"]');
    assert.match(await message.textContent(), /^Permission locale requise\./);
    const helpLink = message.getByRole('link', { name: 'Learn more' });
    assert.equal(
        await helpLink.getAttribute('href'),
        'https://fixture.invalid/permission'
    );
    assert.equal(await helpLink.getAttribute('target'), '_blank');
    const help = error.getByRole('button', { name: 'Aide sur la permission' });
    assert.equal(await help.getAttribute('type'), 'button');
    await help.click();
    assert.equal((await probe()).helps, 1);

    const upload = await checkFieldUploadDialog(
        page,
        form,
        configure,
        probe,
        nativeConfirm
    );
    const final = await probe();
    assert.deepEqual(final.files, files);
    assert.deepEqual(final.urls, urls);
    assert.equal(final.submits, 0);
    assert.equal(final.uploadEscapes, 0);
    await page.evaluate(() => window.attachmentFieldProbe.configure(null));
    await form.waitFor({ state: 'detached' });
    return {
        device: {
            acceptedFiles: files[0],
            associatedForm: true,
            described: true,
        },
        url: { refusedNonHttp: true, drafts: urls },
        readonlyEmpty: true,
        readonlyAcceptedRows: true,
        errorAlert: true,
        errorHelpCalls: final.helps,
        formSubmits: 0,
        upload,
    };
}

const uploadDialogClass = '.mx-sdk-attachment-upload-dialog';

async function checkFieldUploadDialog(
    page,
    form,
    configure,
    probe,
    nativeConfirm
) {
    const viewer = page.locator(uploadDialogClass);
    const panel = viewer.getByTestId('dialog-test-id');
    const backdrop = viewer.getByTestId('dialog-overlay-test-id');
    const opener = form.getByRole('button', {
        name: 'Démarrer le transfert synthétique',
    });
    const cancel = viewer.getByRole('button', { name: 'Annuler le transfert' });
    const progress = viewer.getByRole('progressbar', {
        name: 'Transfert synthétique en cours',
    });
    const scroll = () =>
        page.evaluate(() => ({
            top: window.scrollY,
            overflow: document.documentElement.style.overflow,
        }));

    await page.setViewportSize({ width: 1280, height: 720 });
    await configure('upload');
    const initial = await page.evaluate(() => {
        const root = document.documentElement;
        const oldOverflow = root.style.overflow;
        root.style.overflow = 'auto';
        window.scrollTo(0, 80);
        return { oldOverflow, top: window.scrollY };
    });
    assert.equal(initial.top, 80);
    const locked = { top: initial.top, overflow: 'hidden' };
    const released = { top: initial.top, overflow: 'auto' };

    async function open() {
        await opener.click();
        await waitForSliderFocus(page, cancel);
        assert.equal(await viewer.getAttribute('role'), 'dialog');
        assert.equal(
            await viewer.getAttribute('aria-label'),
            'Transfert synthétique en cours'
        );
        assert.equal(await viewer.getAttribute('aria-modal'), 'true');
        assert.equal(await viewer.getByTestId('close-dialog').count(), 0);
        assert.equal(await viewer.getByRole('button').count(), 1);
        assert.equal(await cancel.getAttribute('type'), 'button');
        assert.equal(await progress.getAttribute('value'), '37');
        assert.equal(await progress.getAttribute('max'), '100');
        assert.deepEqual(await scroll(), locked);
    }
    async function close() {
        await viewer.waitFor({ state: 'detached' });
        await waitForSliderFocus(page, opener);
        assert.deepEqual(await scroll(), released);
    }
    async function layout(width, intercom = false) {
        await page.setViewportSize({ width, height: 720 });
        await page.evaluate(
            (openIntercom) =>
                window.attachmentFieldProbe.intercom(openIntercom),
            intercom
        );
        const right = intercom && width >= 1024 ? 440 : 16;
        const usable = width - 16 - right;
        const panelWidth = Math.min(512, usable);
        const x = 16 + (usable - panelWidth) / 2;
        await page.waitForFunction(
            ({ expectedX, expectedWidth }) => {
                const node = document.querySelector(
                    '.mx-sdk-attachment-upload-dialog__panel'
                );
                const rect = node?.getBoundingClientRect();
                return (
                    rect?.x === expectedX &&
                    rect.width === expectedWidth &&
                    node
                        .getAnimations()
                        .every(
                            (animation) =>
                                !animation.pending &&
                                animation.playState !== 'running'
                        )
                );
            },
            { expectedX: x, expectedWidth: panelWidth }
        );
        const rootBox = await viewer.boundingBox();
        const panelBox = await panel.boundingBox();
        const progressBox = await progress.boundingBox();
        assert.deepEqual(rootBox, { x: 0, y: 0, width, height: 720 });
        assert.ok(panelBox && progressBox);
        const y = width >= 640 ? (720 + 16 - 24 - panelBox.height) / 2 : 16;
        assert.deepEqual(
            [panelBox.x, panelBox.y, panelBox.width],
            [x, y, panelWidth]
        );
        assert.equal(progressBox.height, 8);
        assert.equal(progressBox.width, panelWidth - 32);
        assert.equal(
            await backdrop.evaluate(
                (node) => getComputedStyle(node).backgroundColor
            ),
            'rgba(107, 114, 128, 0.4)'
        );
        assert.equal(
            await viewer
                .locator(uploadDialogClass + '__viewport')
                .getAttribute('data-mx-theme'),
            'purple'
        );
        assert.equal(
            await progress.evaluate(
                (node) => getComputedStyle(node).accentColor
            ),
            'rgb(147, 51, 234)'
        );
        return {
            panel: panelBox,
            progress: [progressBox.width, progressBox.height],
        };
    }

    try {
        await open();
        const desktop = await layout(1280);
        const mobile = await layout(375);
        const mobileIntercom = await layout(375, true);
        assert.deepEqual(mobileIntercom, mobile);
        const desktopIntercom = await layout(1280, true);
        await layout(1280);

        await page.keyboard.press('Tab');
        await waitForSliderFocus(page, cancel);
        await page.keyboard.press('Shift+Tab');
        await waitForSliderFocus(page, cancel);
        await page.keyboard.press('Escape');
        await backdrop.click({ position: { x: 4, y: 80 } });
        assert.equal(await viewer.isVisible(), true);
        assert.equal((await probe()).cancels, 0);
        assert.equal((await probe()).uploadEscapes, 0);
        await page.mouse.move(4, 600);
        await page.mouse.wheel(0, 220);
        await page.evaluate(
            () =>
                new Promise((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(resolve))
                )
        );
        assert.deepEqual(await scroll(), locked);
        await page.evaluate(() => window.attachmentFieldProbe.update(63));
        await viewer.locator('progress[value="63"]').waitFor();
        await cancel.click();
        await close();
        assert.equal((await probe()).cancels, 1);
        assert.equal((await probe()).submits, 0);
        await page.mouse.move(200, 620);
        await page.mouse.wheel(0, 180);
        await page.waitForFunction((y) => window.scrollY > y, initial.top);
        await page.evaluate((y) => window.scrollTo(0, y), initial.top);

        const legacy = nativeConfirm
            ? await checkUploadLegacyConfirm({
                  page,
                  viewer,
                  cancel,
                  configure,
                  open,
                  close,
                  probe,
                  scroll,
                  locked,
              })
            : null;
        return {
            desktop,
            mobile,
            desktopIntercom,
            theme: 'purple',
            progressValues: [37, 63],
            escapeCancelCalls: 0,
            backdropCancelCalls: 0,
            explicitCancelCalls: 1,
            tabContained: true,
            openerRestored: true,
            documentScrollRestored: true,
            legacy,
        };
    } finally {
        await page.evaluate((value) => {
            document.documentElement.style.overflow = value;
        }, initial.oldOverflow);
    }
}

async function checkUploadLegacyConfirm({
    page,
    viewer,
    cancel,
    configure,
    open,
    close,
    probe,
    scroll,
    locked,
}) {
    const confirm = page.getByRole('dialog', {
        name: 'Confirmer l’annulation du transfert',
    });
    const keep = confirm.getByRole('button', {
        name: 'Poursuivre le transfert',
    });
    const accept = confirm.getByRole('button', {
        name: 'Confirmer l’annulation',
        exact: true,
    });

    await configure('upload', true);
    await open();
    await cancel.click();
    await waitForSliderFocus(page, keep);
    assert.deepEqual(await scroll(), locked);
    await page.keyboard.press('Tab');
    await waitForSliderFocus(page, accept);
    await page.keyboard.press('Shift+Tab');
    await waitForSliderFocus(page, keep);
    await page.keyboard.press('Escape');
    assert.equal(await confirm.isVisible(), true);
    assert.equal(await viewer.isVisible(), true);
    await waitForSliderFocus(page, keep);
    assert.equal((await probe()).confirmEscapes, 0);
    await keep.click();
    await confirm.waitFor({ state: 'detached' });
    await waitForSliderFocus(page, cancel);
    assert.equal(await viewer.isVisible(), true);
    assert.deepEqual(await scroll(), locked);
    await page.keyboard.press('Escape');
    assert.equal(await viewer.isVisible(), true);
    assert.equal((await probe()).cancels, 2);
    assert.equal((await probe()).confirmEscapes, 0);
    assert.equal((await probe()).confirmed, 0);

    await cancel.click();
    await waitForSliderFocus(page, keep);
    await accept.click();
    await confirm.waitFor({ state: 'detached' });
    await waitForSliderFocus(page, cancel);
    assert.deepEqual(await scroll(), locked);
    assert.equal((await probe()).cancels, 3);
    assert.equal((await probe()).confirmed, 1);
    await page.evaluate(() => window.attachmentFieldProbe.update(null));
    await close();
    return {
        headlessUi: '1.7.2',
        trapped: true,
        coveredEscapeKeptConfirm: true,
        keepRestoredCancel: true,
        uploadIgnoredSubsequentEscape: true,
        committedConfirmCalls: 1,
        hostCompletionRestoredOpener: true,
    };
}

const galleryClass = '.mx-sdk-attachment-gallery';

async function checkAttachmentGallery(page, requests) {
    const scope = page.locator('#attachment-gallery-proof');
    const list = scope.locator(galleryClass);
    const tiles = scope.getByTestId('gallery-proof-tile');
    const viewer = page.locator(fullscreenClass);
    const frontImage = tiles.first().locator('img[src="/front.svg"]');
    const stats = () => page.evaluate(() => window.galleryProbe.stats());
    const configure = async (options) => {
        const config = {
            scene: 'layout',
            layout: 'thumbnail',
            columns: 3,
            fit: 'cover',
            showNames: true,
            ...options,
        };
        await page.evaluate(
            (next) => window.galleryProbe.configure(next),
            config
        );
        await scope
            .and(
                page.locator(
                    '[data-gallery-scene="' +
                        config.scene +
                        '"][data-gallery-layout="' +
                        config.layout +
                        '"][data-gallery-columns="' +
                        config.columns +
                        '"][data-gallery-fit="' +
                        config.fit +
                        '"][data-gallery-names="' +
                        config.showNames +
                        '"]'
                )
            )
            .waitFor();
        await scope.locator(galleryClass + '--' + config.layout).waitFor();
    };
    const boxes = () =>
        tiles.evaluateAll((nodes) =>
            nodes.map((node) => {
                const { x, y, width, height } = node.getBoundingClientRect();
                return { x, y, width, height };
            })
        );
    const captions = {
        photo: scope.getByText('Image galerie', { exact: true }),
        video: scope.getByText('Vidéo galerie', { exact: true }),
    };
    const result = {};
    await page.evaluate(() => window.scrollTo(0, 0));
    for (const width of [1280, 375]) {
        await page.setViewportSize({ width, height: 720 });

        await configure({ layout: 'grid' });
        await frontImage.waitFor();
        const grid = await boxes();
        assert.equal(grid.length, 6);
        assert.deepEqual(
            grid.map(({ y, width, height }) => [y - grid[0].y, width, height]),
            Array.from({ length: 6 }, () => [0, 48, 48])
        );
        assert.equal(grid[1].x - grid[0].x - grid[0].width, 4);
        assert.equal(await captions.photo.count(), 0);

        await configure({ layout: 'icon' });
        await captions.photo.waitFor();
        await captions.video.waitFor();
        const icon = await boxes();
        assert.equal(icon.length, 6);
        assert.deepEqual(
            icon.map(({ x, height }) => [x, height]),
            Array.from({ length: 6 }, () => [icon[0].x, 56])
        );
        assert.equal(icon[1].y - icon[0].y - icon[0].height, 4);
        const fallbackPaths = (index) =>
            tiles.nth(index).locator('svg[aria-hidden="true"] path').count();
        assert.equal(await fallbackPaths(2), 1);
        assert.equal(await fallbackPaths(3), 2);

        const thumbnail = {};
        for (const columns of [2, 3, 4]) {
            await configure({ columns });
            await captions.photo.waitFor();
            await frontImage.waitFor();
            const cell = await boxes();
            assert.equal(cell.length, 6);
            const firstLine = cell.filter(({ y }) => y === cell[0].y);
            assert.equal(firstLine.length, columns);
            assert.equal(
                Math.round(
                    firstLine[1].x - firstLine[0].x - firstLine[0].width
                ),
                4
            );
            const image = await frontImage.boundingBox();
            assert.ok(image);
            assert.equal(image.width, image.height);
            assert.equal(
                await frontImage.evaluate(
                    (node) => getComputedStyle(node).objectFit
                ),
                'cover'
            );
            thumbnail[columns] = {
                visibleColumns: firstLine.length,
                tileWidth: image.width,
                squareThumbnail: true,
            };
        }
        await configure({ columns: 4, fit: 'contain', showNames: false });
        await frontImage.waitFor();
        assert.equal(await captions.photo.count(), 0);
        assert.equal(
            await frontImage.evaluate(
                (node) => getComputedStyle(node).objectFit
            ),
            'contain'
        );
        result[width] = {
            listWidth: (await list.boundingBox()).width,
            grid: {
                tilesInLine: grid.length,
                tile: [48, 48],
                gap: 4,
                names: false,
            },
            icon: {
                rows: icon.length,
                rowHeight: 56,
                gap: 4,
                names: true,
                playAndDocument: true,
            },
            thumbnail,
            containAndNamesHidden: true,
        };
    }
    assert.ok(result[1280].listWidth > result[375].listWidth);

    await configure({ scene: 'retry', columns: 3, showNames: false });
    const retry = tiles
        .first()
        .getByRole('button', { name: 'Réessayer la tuile' });
    await retry.waitFor();
    assert.equal(await retry.getAttribute('type'), 'button');
    assert.equal(requests.retry, 1);
    await retry.click();
    const recovered = tiles
        .first()
        .locator('img[src="' + galleryRetryImagePath + '"]');
    await recovered.waitFor();
    const image = await recovered.elementHandle();
    assert.ok(image);
    try {
        await page.waitForFunction(
            (node) => node.complete && node.naturalWidth > 0,
            image
        );
    } finally {
        await image.dispose();
    }
    assert.equal(requests.retry, 2);
    assert.equal(await retry.count(), 0);
    assert.equal((await stats()).submits, 0);
    assert.equal(await viewer.count(), 0);

    const open = tiles.first().locator('.mx-sdk-attachment-tile__open');
    await open.click();
    await viewer.waitFor();
    await viewer.locator('img[src="/front.svg"]').first().waitFor();
    await viewer.getByRole('button', { name: 'Fermer la visionneuse' }).click();
    await viewer.waitFor({ state: 'detached' });
    await waitForSliderFocus(page, open);

    await configure({ scene: 'actions' });
    await tiles.first().hover();
    assert.equal(await scope.getByTestId('gallery-remove-front').count(), 1);
    assert.equal(
        await scope.getByRole('button', { name: 'Retirer la tuile' }).count(),
        1
    );
    assert.equal(
        await scope.getByRole('button', { name: 'Annoter la tuile' }).count(),
        1
    );
    await scope.getByTestId('gallery-remove-front').click();
    assert.equal(await viewer.count(), 0);
    await tiles
        .first()
        .getByRole('button', { name: 'Annoter la tuile' })
        .click();
    assert.equal(await viewer.count(), 0);

    assert.equal(requests.document, 0);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await configure({ scene: 'document', columns: 3, showNames: false });
    await page.evaluate(
        () =>
            new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve))
            )
    );
    assert.equal(requests.document, 0);
    await tiles.first().scrollIntoViewIfNeeded();
    await tiles
        .first()
        .locator('[data-document-thumbnail="text"]')
        .getByText(galleryDocumentText, { exact: true })
        .waitFor();
    assert.equal(requests.document, 1);

    const office = await checkGalleryOffice({
        page,
        tiles,
        configure,
        requests,
    });
    assert.deepEqual(await stats(), {
        submits: 0,
        removals: [0],
        annotations: [0],
        documentReads: 1,
        officeHeads: 1,
        downloads: 0,
    });

    await page.evaluate(() => window.galleryProbe.configure(null));
    await scope.waitFor({ state: 'detached' });
    assert.equal(await viewer.count(), 0);
    return {
        layouts: result,
        recoveredImageRequests: requests.retry,
        retrySubmits: 0,
        openedFullscreen: true,
        restoredGalleryOpener: true,
        removeCalls: 1,
        annotateCalls: 1,
        actionsOpenedSlider: false,
        office,
        document: {
            ownedReads: requests.document,
            offscreenReads: 0,
            renderedText: galleryDocumentText,
        },
    };
}

async function checkGalleryOffice({ page, tiles, configure, requests }) {
    await page.setViewportSize({ width: 1280, height: 720 });
    await configure({ scene: 'office', showNames: false });
    await tiles.first().scrollIntoViewIfNeeded();
    const frameSelector = 'iframe#msdoc-iframe';
    const frame = tiles.first().locator(frameSelector);
    await frame.waitFor();
    assert.equal(await frame.getAttribute('title'), 'msdoc-iframe');
    assert.equal(
        await frame.getAttribute('src'),
        galleryOfficeOrigin +
            '/op/embed.aspx?src=' +
            encodeURIComponent(new URL(galleryOfficePath, page.url()).href)
    );
    await page
        .frameLocator(frameSelector)
        .getByText(galleryOfficeFrameText, { exact: true })
        .waitFor();
    const sizes = {};
    for (const width of [1280, 375]) {
        await page.setViewportSize({ width, height: 720 });
        const bounds = await frame.boundingBox();
        assert.ok(bounds && bounds.width > 0 && bounds.height > 0);
        sizes[width] = [bounds.width, bounds.height];
    }
    assert.ok(sizes[1280][0] > sizes[375][0]);
    assert.deepEqual(
        [
            requests.officeHeads,
            requests.officeOriginalGets,
            requests.officeFrames,
        ],
        [1, 0, 1]
    );
    return {
        head: 1,
        originalGet: 0,
        mockedFrameLoads: 1,
        title: 'msdoc-iframe',
        sizes,
    };
}

const fullscreenClass = '.mx-sdk-attachment-slider';

async function waitForSliderFocus(page, locator) {
    const element = await locator.elementHandle();
    assert.ok(element);
    try {
        await page.waitForFunction(
            (node) => node.ownerDocument.activeElement === node,
            element
        );
    } finally {
        await element.dispose();
    }
}

async function checkFullscreenSlider(page, nativeConfirm) {
    const viewer = page.locator(fullscreenClass);
    const panel = viewer.getByTestId('dialog-test-id');
    const body = viewer.locator(fullscreenClass + '__body');
    const backdrop = viewer.getByTestId('dialog-overlay-test-id');
    const rail = viewer.locator('.mx-sdk-attachment-thumbnail-rail');
    const opener = page.getByRole('button', { name: 'Ouvrir le plein écran' });
    const close = viewer.getByRole('button', {
        name: 'Fermer la visionneuse',
    });
    const remove = viewer.getByRole('button', {
        name: 'Effacer la pièce jointe',
    });
    const stats = () => page.evaluate(() => window.fullscreenProbe.stats());
    const scroll = () =>
        page.evaluate(() => ({
            y: window.scrollY,
            overflow: document.documentElement.style.overflow,
        }));

    await page.setViewportSize({ width: 1280, height: 720 });
    const baseline = await page.evaluate(() => {
        const root = document.documentElement;
        const oldOverflow = root.style.overflow;
        root.style.overflow = 'auto';
        window.scrollTo(0, 80);
        return {
            oldOverflow,
            y: window.scrollY,
            overflow: root.style.overflow,
        };
    });
    assert.equal(baseline.y, 80);
    const restored = { y: baseline.y, overflow: baseline.overflow };
    const locked = { ...restored, overflow: 'hidden' };
    async function openViewer(trigger) {
        await trigger.click();
        await viewer.waitFor();
        assert.equal(await viewer.getAttribute('role'), 'dialog');
        assert.equal(await viewer.getAttribute('aria-modal'), 'true');
        await waitForSliderFocus(page, rail);
        assert.deepEqual(await scroll(), locked);
    }
    async function closedViewer(trigger, expectedDismissals) {
        await viewer.waitFor({ state: 'detached' });
        await waitForSliderFocus(page, trigger);
        assert.deepEqual((await stats()).dismissals, expectedDismissals);
        assert.deepEqual(await scroll(), restored);
    }
    const bounds = (node) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return [x, y, width, height];
    };
    async function layout(width, intercom = false) {
        await page.setViewportSize({ width, height: 720 });
        await page.evaluate(
            (openIntercom) => window.fullscreenProbe.intercom(openIntercom),
            intercom
        );
        const right = intercom && width >= 1024 ? 440 : 16;
        const bottom = width >= 640 ? 8 : 80;
        const expectedPanel = [16, 16, width - 16 - right, 720 - 16 - bottom];
        await page.waitForFunction(
            ({ selector, expectedWidth }) =>
                document.querySelector(selector)?.getBoundingClientRect()
                    .width === expectedWidth,
            {
                selector: fullscreenClass + '__panel',
                expectedWidth: expectedPanel[2],
            }
        );
        const rootBox = await viewer.evaluate(bounds);
        const panelBox = await panel.evaluate(bounds);
        const bodyBox = await body.evaluate(bounds);
        assert.deepEqual(rootBox, [0, 0, width, 720]);
        assert.deepEqual(panelBox, expectedPanel);
        assert.equal(bodyBox[0], panelBox[0]);
        assert.equal(bodyBox[2], panelBox[2]);
        assert.ok(bodyBox[1] > panelBox[1]);
        assert.equal(bodyBox[1] + bodyBox[3], panelBox[1] + panelBox[3]);
        assert.equal(
            await body.evaluate((node) => getComputedStyle(node).overflowY),
            'auto'
        );
        return { root: rootBox, panel: panelBox, body: bodyBox };
    }

    try {
        await openViewer(opener);
        const desktop = await layout(1280);
        const narrow = await layout(375);
        const narrowIntercom = await layout(375, true);
        assert.deepEqual(narrowIntercom, narrow);
        const desktopIntercom = await layout(1280, true);
        await layout(1280);

        await close.focus();
        await page.keyboard.press('Tab');
        await waitForSliderFocus(page, remove);
        await page.keyboard.press('Shift+Tab');
        await waitForSliderFocus(page, close);
        assert.equal((await stats()).dismissals.length, 0);

        // Supply overflow to the real viewer body so a trusted wheel can prove
        // ownership even when the small image fits the viewport.
        await body.evaluate((node) => {
            const content = node.ownerDocument.createElement('div');
            content.className = 'attachment-fullscreen-scroll-probe';
            node.append(content);
        });
        const bodyBox = await body.boundingBox();
        assert.ok(bodyBox);
        await page.mouse.move(bodyBox.x + 5, bodyBox.y + bodyBox.height / 2);
        await page.mouse.wheel(0, 240);
        await page.waitForFunction(
            (selector) => document.querySelector(selector)?.scrollTop > 0,
            fullscreenClass + '__body'
        );
        assert.deepEqual(await scroll(), locked);
        await body
            .locator('.attachment-fullscreen-scroll-probe')
            .evaluate((node) => node.remove());

        await close.click();
        await closedViewer(opener, ['standalone']);
        await page.mouse.move(200, 620);
        await page.mouse.wheel(0, 180);
        await page.waitForFunction((y) => window.scrollY > y, baseline.y);
        await page.evaluate((y) => window.scrollTo(0, y), baseline.y);

        await openViewer(opener);
        await backdrop.click({ position: { x: 4, y: 80 } });
        await closedViewer(opener, ['standalone', 'standalone']);

        await openViewer(opener);
        await page.keyboard.press('Escape');
        await closedViewer(opener, ['standalone', 'standalone', 'standalone']);

        const legacyConfirm = nativeConfirm
            ? await checkLegacySliderConfirm({
                  page,
                  viewer,
                  rail,
                  remove,
                  close,
                  stats,
                  openViewer,
                  closedViewer,
                  locked,
                  scroll,
              })
            : null;
        return {
            desktop,
            narrow,
            desktopIntercom,
            narrowIntercom,
            initialRailFocus: true,
            tabWrap: true,
            dismissals: ['close', 'backdrop', 'escape'],
            openerFocusRestored: true,
            viewerWheelOwned: true,
            documentScrollRestored: true,
            legacyConfirm,
        };
    } finally {
        await page.evaluate((overflow) => {
            document.documentElement.style.overflow = overflow;
        }, baseline.oldOverflow);
    }
}

async function checkFullscreenDownloadPress(page) {
    const viewer = page.locator(fullscreenClass);
    const download = viewer.getByRole('button', {
        name: 'Télécharger la pièce jointe',
    });
    const rail = viewer.locator('.mx-sdk-attachment-thumbnail-rail');
    const selected = rail.locator('button[data-selected="true"]');
    const reads = () =>
        page.evaluate(() => window.fullscreenProbe.downloadReads());
    await page
        .getByRole('button', { name: 'Ouvrir les fichiers à télécharger' })
        .click();
    await selected.getByText('Vue avant.svg', { exact: true }).waitFor();
    const saves = [];
    const capture = (file) => saves.push(file);
    page.on('download', capture);
    async function holdDownload(change) {
        const original = await download.elementHandle();
        await download.hover();
        await page.mouse.down();
        try {
            await change();
            assert.ok(
                await download.evaluate(
                    (button, held) => button === held,
                    original
                )
            );
            await original.evaluate((button) => {
                window.fullscreenDownloadClick = null;
                document.addEventListener(
                    'click',
                    (event) => {
                        window.fullscreenDownloadClick = {
                            sameButton: event.composedPath().includes(button),
                            trusted: event.isTrusted,
                            pointerType: event.pointerType,
                            detail: event.detail,
                        };
                    },
                    { capture: true, once: true }
                );
            });
            await download.hover();
        } finally {
            try {
                await page.mouse.up();
                assert.deepEqual(
                    await page.evaluate(() => window.fullscreenDownloadClick),
                    {
                        sameButton: true,
                        trusted: true,
                        pointerType: 'mouse',
                        detail: 1,
                    },
                    'Release must deliver a trusted click to the held Download button'
                );
            } finally {
                await original.dispose();
            }
        }
    }
    async function expectDownload(activate, filename) {
        const [file] = await Promise.all([
            page.waitForEvent('download'),
            activate(),
        ]);
        assert.equal(file.suggestedFilename(), filename);
        assert.equal(readFileSync(await file.path(), 'utf8'), rearDownloadSvg);
        await download.waitFor();
    }
    try {
        await holdDownload(async () => {
            await page.evaluate(() =>
                window.fullscreenProbe.selectDownloadRow(1)
            );
            await selected
                .getByText('Vue arrière.svg', { exact: true })
                .waitFor();
        });
        assert.deepEqual(
            await reads(),
            [],
            'A held Download press must not read the newly selected attachment'
        );
        assert.equal(saves.length, 0);
        await expectDownload(() => download.click(), 'Vue arrière.svg');
        assert.deepEqual(await reads(), ['/rear.svg']);
        assert.equal(saves.length, 1);
        await expectDownload(
            () =>
                holdDownload(async () => {
                    await page.evaluate(() =>
                        window.fullscreenProbe.renameDownload()
                    );
                    await selected
                        .getByText('Vue arrière actualisée.svg', {
                            exact: true,
                        })
                        .waitFor();
                }),
            'Vue arrière actualisée.svg'
        );
        assert.deepEqual(await reads(), ['/rear.svg', '/rear.svg']);
        assert.equal(saves.length, 2);
        await expectDownload(
            () => download.press('Enter'),
            'Vue arrière actualisée.svg'
        );
        assert.deepEqual(await reads(), [
            '/rear.svg',
            '/rear.svg',
            '/rear.svg',
        ]);
        assert.equal(saves.length, 3);
        return {
            staleReads: 0,
            staleDownloads: 0,
            trustedReleaseOnSameButton: true,
            freshRear: true,
            metadataRefresh: true,
            keyboardDownload: true,
        };
    } finally {
        page.off('download', capture);
        for (const file of saves) await file.delete();
        await viewer
            .getByRole('button', { name: 'Fermer la visionneuse' })
            .click();
        await viewer.waitFor({ state: 'detached' });
    }
}

async function checkLegacySliderConfirm({
    page,
    viewer,
    rail,
    remove,
    close,
    stats,
    openViewer,
    closedViewer,
    locked,
    scroll,
}) {
    const opener = page.getByRole('button', {
        name: 'Ouvrir avec confirmation native',
    });
    const dialog = page.getByRole('dialog', {
        name: 'Confirmer la suppression',
    });
    const cancel = dialog.getByRole('button', { name: 'Annuler' });
    const confirm = dialog.getByRole('button', {
        name: 'Confirmer',
        exact: true,
    });
    const dismissals = ['standalone', 'standalone', 'standalone'];

    await openViewer(opener);
    await remove.click();
    await waitForSliderFocus(page, cancel);
    assert.equal(await dialog.getAttribute('aria-modal'), 'true');
    await page.mouse.move(6, 120);
    assert.deepEqual(await scroll(), locked);
    const selections = (await stats()).selections;
    await page.keyboard.press('Tab');
    await waitForSliderFocus(page, confirm);
    await page.keyboard.press('Shift+Tab');
    await waitForSliderFocus(page, cancel);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await waitForSliderFocus(page, cancel);
    assert.equal((await stats()).selections, selections);
    assert.equal(
        await rail.locator('button[data-selected="true"]').textContent(),
        'Vue avant'
    );

    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    await waitForSliderFocus(page, remove);
    assert.equal(await viewer.isVisible(), true);
    assert.deepEqual((await stats()).dismissals, dismissals);
    assert.equal((await stats()).confirmed, 0);
    assert.equal((await stats()).confirmDismissals, 1);
    assert.deepEqual(await scroll(), locked);
    await page.keyboard.press('Escape');
    await closedViewer(opener, [...dismissals, 'native']);

    await openViewer(opener);
    await remove.click();
    await waitForSliderFocus(page, cancel);
    await confirm.click();
    await dialog.waitFor({ state: 'detached' });
    await waitForSliderFocus(page, remove);
    assert.deepEqual(await stats(), {
        dismissals: [...dismissals, 'native'],
        deleteRequests: 2,
        confirmed: 1,
        confirmDismissals: 1,
        selections,
    });
    await close.click();
    await closedViewer(opener, [...dismissals, 'native', 'native']);
    return {
        headlessUi: '1.7.2',
        confirmFocusTrapped: true,
        coveredArrowsIgnored: true,
        firstEscapeRestoredDelete: true,
        secondEscapeRestoredOpener: true,
        confirmedCallbacks: 1,
        documentScrollRestored: true,
    };
}

async function checkSliderActions(page) {
    const scope = page.getByRole('region', {
        name: 'Commandes de la pièce jointe',
    });
    const remove = scope.getByRole('button', { name: 'Effacer', exact: true });
    const download = (name) => scope.getByRole('button', { name, exact: true });
    const open = scope.getByRole('link', { name: 'Ouvrir', exact: true });
    const tooltip = page.getByRole('tooltip');
    const calls = () => page.evaluate(() => window.sliderProbe.headerCalls());
    await page.evaluate(() => window.sliderProbe.showHeader());
    await open.waitFor();
    assert.equal(await open.getAttribute('href'), '/rear.svg');
    assert.equal(await open.getAttribute('target'), '_blank');
    const widths = {};
    for (const width of [1280, 375]) {
        await page.setViewportSize({ width, height: 720 });
        const removeBox = await remove.boundingBox();
        const downloadBox = await download('Télécharger').boundingBox();
        assert.ok(removeBox && downloadBox);
        widths[width] = {
            control: [removeBox.width, removeBox.height],
            gap: downloadBox.x - removeBox.x - removeBox.width,
        };
        assert.deepEqual(widths[width], { control: [20, 20], gap: 16 });
    }
    await open.hover();
    await tooltip.waitFor();
    assert.equal(await tooltip.innerText(), 'Ouvrir');
    assert.equal(
        await open.getAttribute('aria-describedby'),
        await tooltip.getAttribute('id')
    );
    const openBox = await open.boundingBox();
    const tipBox = await tooltip.boundingBox();
    assert.ok(openBox && tipBox);
    assert.equal(tipBox.y - openBox.y - openBox.height, 8);
    await page.keyboard.press('Escape');
    await tooltip.waitFor({ state: 'detached' });
    assert.equal((await calls()).escapes, 0);

    await remove.click();
    assert.equal((await calls()).deletes, 1);
    await download('Télécharger').click();
    await download('0%').waitFor();
    assert.equal(await download('0%').isDisabled(), true);
    await page.evaluate(() => window.sliderProbe.revokeHeader());
    await scope.locator('a').click({ button: 'right' });
    assert.equal(await scope.locator('a').getAttribute('href'), null);
    await page.evaluate(() => window.sliderProbe.settleHeader());
    await download('Télécharger').waitFor();
    assert.deepEqual(await calls(), {
        deletes: 1,
        reads: ['/rear.svg'],
        errors: 0,
        escapes: 0,
    });
    await page.evaluate(() => window.sliderProbe.closeHeader());
    await scope.waitFor({ state: 'detached' });
    await tooltip.waitFor({ state: 'detached' });
    return {
        widths,
        tooltipOffset: 8,
        staleOpenRetired: true,
        retiredDownloadSaved: false,
    };
}

async function checkSliderBody(page) {
    const body = page.getByRole('dialog', { name: 'Visionneuse' });
    const navigation = body.getByRole('group', {
        name: 'Aperçu des pièces jointes',
    });
    const rail = body.locator('.mx-sdk-attachment-thumbnail-rail');
    const front = navigation.getByText('Vue avant', { exact: true });
    const rear = navigation.getByText('Vue arrière', { exact: true });
    const open = () => page.evaluate(() => window.sliderProbe.openBody());
    const selections = () =>
        page.evaluate(() => window.sliderProbe.bodySelections());

    await open();
    await front.waitFor();
    const widths = {};
    for (const width of [1280, 375]) {
        await page.setViewportSize({ width, height: 720 });
        const panel = await body.boundingBox();
        const navigationBox = await navigation.boundingBox();
        const railBox = await rail.boundingBox();
        assert.ok(panel && navigationBox && railBox);
        widths[width] = {
            panel: [panel.width, panel.height],
            navigation: [navigationBox.width, navigationBox.height],
            rail: [railBox.width, railBox.height],
        };
        const expectedWidth = Math.min(640, width - 32);
        assert.deepEqual(widths[width], {
            panel: [expectedWidth, 360],
            navigation: [expectedWidth, 316],
            rail: [expectedWidth, 44],
        });
    }

    const owner = await body.getAttribute('data-body-owner');
    await rail.focus();
    await page.keyboard.down('ArrowRight');
    try {
        await rear.waitFor();
        assert.equal(await selections(), 1);
        await open();
        await front.waitFor();
        assert.notEqual(await body.getAttribute('data-body-owner'), owner);
        await page.keyboard.down('ArrowRight');
        assert.equal(await selections(), 1);
        assert.equal(await front.isVisible(), true);
    } finally {
        await page.keyboard.up('ArrowRight');
    }
    await page.keyboard.press('ArrowRight');
    await rear.waitFor();
    assert.equal(await selections(), 2);
    await rail.getByRole('button', { name: 'Vue arrière' }).focus();
    await page.evaluate(() => window.sliderProbe.shrinkBody());
    await navigation.waitFor({ state: 'detached' });
    await rail
        .getByRole('button', { name: 'Vue avant' })
        .waitFor({ state: 'visible' });
    assert.equal(
        await rail.evaluate(
            (node) => node.ownerDocument.activeElement === node
        ),
        true
    );
    await page.evaluate(() => window.sliderProbe.emptyBody());
    await body.waitFor({ state: 'detached' });
    return {
        widths,
        retiredHeldArrow: true,
        freshArrowSelected: true,
        restoredRailFocus: true,
        retiredEmptyGallery: true,
    };
}

async function checkTileOpen(page) {
    const tile = page.locator('.attachment-tile-proof');
    const button = (label) =>
        tile.getByRole('button', { name: label, exact: true });
    const publish = (resourceKey, label) =>
        page.evaluate(
            ([key, text]) => window.sliderProbe.publishTile(key, text),
            [resourceKey, label]
        );
    const opened = () => page.evaluate(() => window.sliderProbe.tileOpens);
    const signature = await button('Pièce jointe').evaluate((control) => {
        const style = getComputedStyle(control);
        const bounds = control.getBoundingClientRect();
        const tileBounds = control.parentElement.getBoundingClientRect();
        const label = control.firstElementChild;
        const labelStyle = getComputedStyle(label);
        return {
            type: control.type,
            position: style.position,
            inset: style.inset,
            zIndex: style.zIndex,
            cursor: style.cursor,
            background: style.backgroundColor,
            padding: style.padding,
            borderWidth: style.borderWidth,
            geometry: [
                bounds.x - tileBounds.x,
                bounds.y - tileBounds.y,
                bounds.width,
                bounds.height,
            ],
            hiddenLabel: [
                label.textContent,
                labelStyle.width,
                labelStyle.height,
                labelStyle.overflow,
            ],
        };
    });
    assert.deepEqual(signature, {
        type: 'button',
        position: 'absolute',
        inset: '0px',
        zIndex: '10',
        cursor: 'pointer',
        background: 'rgba(0, 0, 0, 0)',
        padding: '0px',
        borderWidth: '0px',
        geometry: [0, 0, 96, 48],
        hiddenLabel: ['Open attachment', '1px', '1px', 'hidden'],
    });

    async function gesture(input, replaceResource) {
        const resource = `${input}-${replaceResource ? 'replace' : 'relabel'}`;
        const before = `${resource} initial`;
        const after = `${resource} courant`;
        await publish(resource, before);
        const original = await button(before).elementHandle();
        assert.ok(original);
        const count = (await opened()).length;
        if (input === 'pointer') {
            const bounds = await original.boundingBox();
            assert.ok(bounds);
            await page.mouse.move(
                bounds.x + bounds.width / 2,
                bounds.y + bounds.height / 2
            );
            await page.mouse.down();
        } else {
            await original.focus();
            await page.keyboard.down('Space');
        }
        await publish(
            replaceResource ? `${resource}-successor` : resource,
            after
        );
        const current = button(after);
        const state = await current.evaluate(
            (control, previous) => ({
                sameControl: control === previous,
                focused: control.ownerDocument.activeElement === control,
            }),
            original
        );
        await original.dispose();
        assert.deepEqual(state, {
            sameControl: !replaceResource,
            focused: true,
        });
        if (input === 'pointer') await page.mouse.up();
        else {
            if (replaceResource) await page.keyboard.down('Space');
            await page.keyboard.up('Space');
        }
        const held = (await opened()).slice(count);
        assert.deepEqual(held, replaceResource ? [] : [after]);
        if (!replaceResource) return { ...state, held };

        if (input === 'pointer') await current.click();
        else await current.press('Space');
        const fresh = (await opened()).slice(count);
        assert.deepEqual(fresh, [after]);
        return { ...state, held, fresh };
    }

    return {
        signature,
        replacedPointer: await gesture('pointer', true),
        replacedSpace: await gesture('space', true),
        relabeledPointer: await gesture('pointer', false),
        relabeledSpace: await gesture('space', false),
    };
}
