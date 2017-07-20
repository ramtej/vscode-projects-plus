
/* IMPORT */

import * as _ from 'lodash';
import * as fs from 'fs';
import * as path from 'path';
import * as pify from 'pify';
import * as vscode from 'vscode';
import Config from './config';
import * as Fetchers from './fetchers';
import Utils from './utils';
const {fetchPathDescription, enhanceWithDescriptions, fetchProjectsFolders, fetchProjectsGitTower} = Fetchers; //FIXME: Importing them directly doesn't work for some reason

/* COMMANDS */

async function initConfig () {

  const config = await Config.get ();
  const defaultConfig = {
    groups: [{
      name: 'Group',
      projects: [{
        name: 'Nested Project',
        description: "An awesome nested project",
        path: '/path/to/nested/project'
      }]
    }],
    projects: [{
      name: 'Project',
      description: 'An awesome project',
      path: '/path/to/project'
    }]
  };

  return Config.write ( config.configPath, defaultConfig );

}

async function editConfig () {

  const config = await Config.get (),
        hasFile = !!( await Utils.file.read ( config.configPath ) );

  if ( !hasFile ) await initConfig ();

  return Utils.file.open ( config.configPath );

}

async function open ( inNewWindow?, onlyGroups? ) {

  /* VARIABLES */

  const config = await Config.get (),
        configFiltered = onlyGroups ? config : Utils.config.filterByGroup ( config, config.group ),
        {items, projectsNr, groupsNr} = await Utils.quickPick.makeItems ( config, configFiltered, 0, onlyGroups );

  /* NO PROJECTS */

  if ( !projectsNr && ( !onlyGroups || !groupsNr ) ) {

    const option = await vscode.window.showErrorMessage ( 'No projects defined, refresh them or edit the configuration', { title: 'Refresh' }, { title: 'Edit' } ),
          action = option && option.title;

    switch ( action ) {
      case 'Refresh': return refresh ();
      case 'Edit': return editConfig ();
      default: return;
    }

  }

  /* QUICK PICK */

  const placeHolder = projectsNr
                        ? groupsNr
                            ? 'Select a project or a group...'
                            :  'Select a project...'
                        : 'Select a group...';

  const selected = await vscode.window.showQuickPick ( items, { placeHolder } );

  if ( !selected ) return;

  const {name, path} = selected.obj;

  if ( path ) { // Project

    return Utils.folder.open ( path, inNewWindow );

  } else { // Group

    return Utils.config.switchGroup ( config, name );

  }

}

async function openInNewWindow () {

  return open ( true );

}

async function refresh () {

  const config = await Config.get (),
        dataGitTower = await fetchProjectsGitTower (),
        dataGeneral = await fetchProjectsFolders ( config.refreshRoots, config.refreshDepth, config.refreshIgnoreFolders, ['.vscode', '.git', '.svn'] ),
        data = [dataGitTower, dataGeneral],
        didFind = data.some ( config => !_.isEqual ( config, {} ) );

  if ( !didFind && !config.refreshRoots.length ) return vscode.window.showErrorMessage ( 'No projects found, add some paths to the "projects.refreshRoots" setting' );

  const configFile = await Config.getFile ( config.configPath ),
        configMerged = Config.merge ( {}, configFile, ...data ) as any,
        configEnhanced = await enhanceWithDescriptions ( configMerged );

  await Config.write ( config.configPath, configEnhanced );

  return open ();

}

async function remove () {

  const {rootPath} = vscode.workspace;

  if ( !rootPath ) return vscode.window.showErrorMessage ( 'You have to open a project before removing it' );

  const config = await Config.get (),
        configFile = await Config.getFile ( config.configPath ),
        project = Utils.config.getProjectByPath ( config, rootPath );

  if ( !project ) return vscode.window.showErrorMessage ( 'This project has not been saved, yet' );

  const option = await vscode.window.showInformationMessage ( `Do you want to remove "${project.name}" from your projects?`, { title: 'Remove' } );

  if ( !option || option.title !== 'Remove' ) return;

  Utils.config.removeProject ( configFile, project );

  return Config.write ( config.configPath, configFile );

}

async function save () {

  /* ROOTPATH */

  const {rootPath} = vscode.workspace;

  if ( !rootPath ) return vscode.window.showErrorMessage ( 'You have to open a project before saving it' );

  /* VARIABLES */

  const config = await Config.get (),
        configFile = await Config.getFile ( config.configPath ) || {},
        sameProject = Utils.config.getProjectByPath ( configFile, rootPath ),
        sameProjectGroup = sameProject ? Utils.config.getProjectGroup ( configFile, sameProject.path ) : undefined,
        nameHint = rootPath.substr ( rootPath.lastIndexOf ( path.sep ) + 1 ),
        descriptionHint = sameProject && sameProject.description ? sameProject.description : await fetchPathDescription ( rootPath ),
        groupHint = config.group || ( sameProjectGroup ? sameProjectGroup.name : undefined );

  /* NAME */

  const name = await vscode.window.showInputBox ({
    prompt: 'Project name',
    placeHolder: 'Type a name for your project',
    value: nameHint
  });

  if ( _.isUndefined ( name ) ) return;

  if ( !name ) return vscode.window.showWarningMessage ( 'You must provide a name for the project.' );

  /* DESCRIPTION */

  const description = await vscode.window.showInputBox ({
    prompt: 'Project description',
    placeHolder: 'Type a description for your project (optional)',
    value: descriptionHint
  });

  if ( _.isUndefined ( description ) ) return;

  /* GROUP */

  const groupName = await vscode.window.showInputBox ({
    prompt: 'Group name',
    placeHolder: 'Type the name of the group (optional)',
    value: groupHint
  });

  if ( _.isUndefined ( groupName ) ) return;

  const group = groupName ? Utils.config.getGroupByName ( configFile, groupName ) || Utils.config.addGroup ( configFile, groupName ) : configFile;

  /* PROJECTS */

  if ( !group.projects ) group.projects = [];

  const {projects} = group;

  /* PROJECT */

  const projectData = _.omitBy ( { name, description, path: rootPath }, _.isEmpty ) as any;

  if ( sameProject ) {

    _.extend ( sameProject, projectData );

    if ( sameProjectGroup && sameProjectGroup.name !== groupName ) {

      Utils.config.moveProject ( sameProject, sameProjectGroup, group );

    }

  } else {

    projects.push ( projectData );

  }

  /* SAVE */

  return Config.write ( config.configPath, configFile );

}

async function switchGroup () {

  open ( undefined, true );

}

/* EXPORT */

export {initConfig, editConfig, open, openInNewWindow, refresh, remove, save, switchGroup};
