'use babel'

/*
Copyright 2018 Amazon.com, Inc. or its affiliates. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License").
You may not use this file except in compliance with the License.
A copy of the License is located at

    http://www.apache.org/licenses/LICENSE-2.0

or in the "license" file accompanying this file. This file is distributed
on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
express or implied. See the License for the specific language governing
permissions and limitations under the License.
*/

// eslint-disable-next-line import/no-extraneous-dependencies, import/extensions
import { CompositeDisposable } from 'atom'

let helpers


const loadDeps = () => {
  if (!helpers) {
    helpers = require('atom-linter')
  }
}

// Internal variables
const idleCallbacks = new Set()

const makeIdleCallback = (work) => {
  let callbackId
  const callBack = () => {
    idleCallbacks.delete(callbackId)
    work()
  }
  callbackId = window.requestIdleCallback(callBack)
  idleCallbacks.add(callbackId)
}

const scheduleIdleTasks = () => {
  const linterAtomCfnLintInstallPeerPackages = () => {
    console.log('test')
    require('atom-package-deps').install('atom-cfn-lint')
  }
  const linterAtomCfnLintStartWorker = () => {
    loadDeps()
  }

  if (!atom.inSpecMode()) {
    makeIdleCallback(linterAtomCfnLintInstallPeerPackages)
    makeIdleCallback(linterAtomCfnLintStartWorker)
  }
}

module.exports = {
  config: {
    cfnLintExecutablePath: {
      title: 'Cfn-Lint Executable Path',
      type: 'string',
      description: 'Path to Cfn-Lint executable (e.g. /usr/bin/cfn-lint) if not in shell env path.',
      default: 'cfn-lint',
    },
    ignoreRules: {
      title: 'Ignore Rules',
      type: 'array',
      default: [],
      items: {
        type: 'string'
      },
      description: 'Ignore Rules (space deliminated)'
    },
    appendRules: {
      title: 'Append Rules Directory',
      type: 'array',
      default: [],
      items: {
        type: 'string'
      },
      description: 'Append Rules Directory (space deliminated)'
    },
    overrideSpecPath: {
      title: 'Override Spec file path',
      type: 'string',
      description: '(Optional) Path to an override specfile json file',
      default: ''
    }
  },
  // activate linter
  activate() {
    this.subscriptions = new CompositeDisposable()

    this.subscriptions.add(
      atom.config.observe(
        'atom-cfn-lint.cfnLintExecutablePath',
        (value) => { this.cfnLintExecutablePath = value }
      ),
      atom.config.observe(
        'atom-cfn-lint.ignoreRules',
        (value) => { this.ignoreRules = value }
      ),
      atom.config.observe(
        'atom-cfn-lint.appendRules',
        (value) => { this.appendRules = value }
      ),
      atom.config.observe(
        'atom-cfn-lint.overrideSpecPath',
        (value) => { this.overrideSpecPath = value }
      ),
    )

    scheduleIdleTasks()
  },

  deactivate() {
    idleCallbacks.forEach(callbackID => window.cancelIdleCallback(callbackID))
    idleCallbacks.clear()
    this.subscriptions.dispose()
  },

  provideLinter() {
    return {
      name: 'Cfn-Lint',
      grammarScopes: ['source.yaml', 'source.json'],
      scope: 'file',
      lintsOnChange: false,
      lint: (activeEditor) => {
        // setup variables
        if (!atom.workspace.isTextEditor(activeEditor)) {
          // If we somehow get fed an invalid TextEditor just immediately return
          return null
        }

        const file = activeEditor.getPath()
        if (!file) {
          // The editor currently has no path, we can't report messages back to
          // Linter so just return null
          return null
        }

        loadDeps()

        const isCfnRegex = new RegExp('"?AWSTemplateFormatVersion"?')

        let isCfn = false
        activeEditor.buffer.buffer.getLines().forEach((line) => {
          if (isCfnRegex.exec(line)) {
            isCfn = true
          }
        })

        function emptyArray() {
          return new Promise((resolve) => {
            resolve([])
          })
        }

        if (!(isCfn)) {
          return emptyArray().then(() => [])
        }

        // parseable output is required
        let args = ['--format', 'json']

        // add file to check
        args = args.concat(['--template', file])
        args = args.concat(['--ignore-bad-template'])

        let i
        if (Array.isArray(this.ignoreRules) && this.ignoreRules.length) {
          args = args.concat(['--ignore-checks'])
          for (i = 0; i < this.ignoreRules.length; i += 1) {
            args = args.concat([this.ignoreRules[i]])
          }
        }

        if (Array.isArray(this.appendRules) && this.appendRules.length) {
          args = args.concat(['--append-rules'])
          for (i = 0; i < this.appendRules.length; i += 1) {
            args = args.concat([this.appendRules[i]])
          }
        }

        if (atom.config.get('atom-cfn-lint.overrideSpecPath') !== '') {
          args = args.concat(['--override-spec']);
          args = args.concat([atom.config.get('atom-cfn-lint.overrideSpecPath')]);
        }

        return helpers.exec(atom.config.get('atom-cfn-lint.cfnLintExecutablePath'), args, {cwd: require('path').dirname(file), ignoreExitCode: true}).then(output => {
          JSON.parse(output).forEach(function (match) {
            linenumber = parseInt(match.Location.Start.LineNumber) - 1;
            columnnumber = parseInt(match.Location.Start.ColumnNumber) - 1;
            linenumberend = parseInt(match.Location.End.LineNumber) - 1;
            columnnumberend = parseInt(match.Location.End.ColumnNumber) - 1;

            toReturn.push({
              severity: match.Level.toLowerCase(),
              excerpt: match.Message,
              location: {
                file,
                position: [[linenumber, columnnumber], [linenumberend, columnnumberend]],
              },
            })
          })

          return toReturn
        })
          .catch((error) => {
            console.log(error.message)
            atom.notifications.addError(
              'An unexpected error with cloudformation, cfn-lint, atom-cfn-lint, atom, linter, and/or your playbook, has occurred.',
              {
                detail: error.message
              }
            )
            return toReturn
          })
      }
    }
  }
}
