;(function($) {
  // register namespace
  $.extend(true, window, {
    cadc: {
      web: {
        science: {
          portal: {
            PortalApp: PortalApp,
            // Events
            events: {
              onSessionRequestOK: new jQuery.Event('sciPort:onSessionRequestOK'),
              onSessionRequestFail: new jQuery.Event('sciPort:onSessionRequestFail'),
            }
          }
        }
      }
    }
  })

  /**
   * Controller for Science Portal Launch UI.
   *
   * @constructor
   * @param {{}} inputs   Input configuration.
   *
   * where
   *  inputs = {
   *       baseURL: <URL app is launched from>
   *       sessionsResourceID: '<resourceID of session web service>'
    *    }
   */
  function PortalApp(inputs) {
    var portalCore = new cadc.web.science.portal.core.PortalCore(inputs)
    var portalSessions = new cadc.web.science.portal.session.PortalSession(inputs)
    var _selfPortalApp = this
    this.baseURL = inputs.baseURL
    this.isPolling = false

    // Used for populating type dropdown and displaying appropriate form fields
    // per session type
    var _sessionTypeMap
    // Complete list of form fields available
    var _launchFormFields = ['name', 'type', 'image', 'memory', 'cores']

    // ------------ Page load functions ------------

    function init() {
      attachListeners()
      // Nothing happens if user is not authenticated, so no other page
      // load information is done until this call comes back (see onAuthenticated event below)
      portalCore.checkAuthentication()
    }

    function attachListeners() {
      // Button/page click listeners
      $('.sp-add-session').click(handleAddSession)
      $('.sp-session-reload').click(checkForSessions)

      // These elements are on the icons in the session list
      $('.sp-session-connect').click(handleConnectRequest)

      // These elements are on the session launch form
      $('#sp_reset_button').click(handleResetFormState)
      $('#session_request_form').submit(handleSessionRequest)
      $('#sp_session_type').change(function(){
        setLaunchFormForType($(this).val())
      })

      // This element is on the info modal
      $('#pageReloadButton').click(handlePageRefresh)

      // Data Flow/javascript object listeners
      portalCore.subscribe(portalCore, cadc.web.science.portal.core.events.onAuthenticated, function (e, data) {
        // onServiceURLOK comes from here
        // Contacts the registry to discover where the sessions web service is,
        // builds endpoints used in launch app
        portalCore.init()
      })

      portalCore.subscribe(portalCore, cadc.web.science.portal.core.events.onServiceURLOK, function (e, data) {
        // This will forward to an existing session if it exists
        // Enforces 'one session per user' rule
        portalSessions.setServiceURLs(portalCore.sessionServiceURL)
        checkForSessions()
      })

      portalCore.subscribe(portalCore, cadc.web.science.portal.core.events.onServiceURLFail, function (e, data){
        // Unable to contact registry to get sessions web service URL
        portalCore.setProgressBar('error')
        portalCore.setInfoModal('Page Unavailable', 'Unable to establish communication with Skaha web service. '
          + 'Reload page to try again or contact CANFAR admin for assistance.', true, false, false)
      })

      portalCore.subscribe(portalSessions, cadc.web.science.portal.session.events.onLoadSessionListDone, function (e) {
        // Build session list on top of page
        populateSessionList(portalSessions.getSessionList())
        portalCore.setProgressBar("okay")
        portalCore.hideInfoModal(true)

        if ( _selfPortalApp.isPolling === false) {
          // Flag polling is occurring so only one instance is running at a time.
          // Any changes in session list will be picked up by the single polling instance
          _selfPortalApp.isPolling == true

          // If everything is stable, stop. If no, kick off polling
          portalSessions.pollSessionList(1000)
            .then(function (finalState) {
              if (finalState == 'done') {
                // Grab new session list
                populateSessionList(portalSessions.getSessionList())
              }
            })
            .catch(function (message) {
              portalCore.setInfoModal('Error getting session list',
                'Unable to get session list. ' +
                'Reload the page to try again, or contact CANFAR admin for assistance.', true, false, false)
            })

          _selfPortalApp.isPolling = false
        }

      })

      portalCore.subscribe(portalSessions, cadc.web.science.portal.session.events.onLoadSessionListError, function (e, request){
        // This should be triggered if the user doesn't have access to Skaha resources, as well as
        // other error conditions. Without access to Skaha, the user should be blocked from using the page,
        // but be directed to some place they can ask for what they need (a resource allocation.)

        if (request.status == 403) {
          portalCore.setInfoModal('Skaha authorization issue', portalCore.getRcDisplayText(request), true, false, false)
        } else {
          // There some other problem contacting the session service. Report the error
          portalCore.setAjaxFail(request)
        }
      })

      portalCore.subscribe(portalSessions, cadc.web.science.portal.session.events.onPollingContinue, function (e) {
        // Rebuild session list on top of page
        populateSessionList(portalSessions.getSessionList())
      })

      portalCore.subscribe(_selfPortalApp, cadc.web.science.portal.events.onSessionRequestOK, function (e, sessionData) {
        // hide launch form
        showLaunchForm(false)
        checkForSessions()
      })

      portalCore.subscribe(portalSessions, cadc.web.science.portal.session.events.onSessionDeleteOK, function (e, sessionID) {
        portalCore.hideInfoModal(true)
        checkForSessions()
      })

    } // end attachListeners()

    // ------------ Data display functions

    function populateSessionList(sessionData) {
      var $sessionListDiv = $('#sp_session_list')

      // Clear listeners
      $('.sp-session-connect').off('click')
      $('.sp-session-delete').off('click')

      // Clear session list
      $sessionListDiv.empty()

      // Make new list from sessionData
      var $unorderedList = $('<ul />')
      $unorderedList.prop('class', 'nav nav-pills')

      // Build new list
      // Assuming a list of sessions is provided, with connect url, name, type
      $(sessionData).each(function () {

        var $listItem = $('<li />')
        $listItem.prop('class', 'sp-session-link')

        // $itemContainer holds both the linkItem with the
        // connect and delete controls, sesion type logo, etc.,
        // and potentially a 'blockingDiv' that puts a panel
        // over the linkItem, blocking access when the session
        // isn't Running.
        var $itemContainer = $('<div />')
        $itemContainer.prop('class', 'sp-link-container')

        if (this.status != 'Running') {
          // Add the extra blocking div
          var $blockingDiv = $('<div />')
          $blockingDiv.prop('class', 'sp-link-disable')
          $itemContainer.append($blockingDiv)
          $blockingDiv.html(this.status)
        }

        // Create the main $linkItem div to hold session
        // information and action controls
        var $linkItem = $('<div />')
        $linkItem.prop('class', 'sp-link-connect')

        var $titleDiv = $('<div />')
        $titleDiv.prop('class', 'sp-session-title')
        var $titleItem = $('<div />')
        $titleItem.prop('class', 'sp-session-name')
        $titleItem.html(this.name)
        $titleDiv.append($titleItem)

        var $deleteButton = $('<button/>')
        // add session data to delete button so it can be
        // sent on click to the delete handler
        $deleteButton.attr('data-id', this.id)
        $deleteButton.attr('data-name', this.name)
        $deleteButton.prop("class", "fas fa-times sp-session-delete")
        $titleItem.append($deleteButton)

        $listItem.append($titleDiv)

        var $anchorDiv = $('<div />')
        $anchorDiv.prop('class', 'sp-session-anchor')
        var $anchorItem = $('<a />')
        $anchorItem.prop('href', '')
        $anchorDiv.append($anchorItem)

        // Attach session data to the anchor element
        $anchorItem.attr('data-connecturl', this.connectURL)
        $anchorItem.attr('data-status', this.status)
        $anchorItem.attr('data-id', this.id)
        $anchorItem.attr('data-name', this.name)
        $anchorItem.prop('class', 'sp-session-connect')

        var $iconItem

        var iconClass
        // TODO: this is the only place that session types
        // are hard coded. Consider expanding sessiontype_map_en.json to include
        // the img logo and icon class
        if (this.type === 'notebook') {
          $iconItem = $('<img />')
          $iconItem.prop('src', _selfPortalApp.baseURL + '/science-portal/images/jupyterLogo.jpg')
          iconClass = 'sp-icon-img'
        } else if (this.type === 'desktop') {
          $iconItem = $('<i />')
          iconClass = 'fas fa-desktop sp-icon-desktop'
        } else if (this.type === 'carta') {
          $iconItem = $('<img />')
          $iconItem.prop('src', _selfPortalApp.baseURL + '/science-portal/images/cartaLogo.png')
          iconClass = 'sp-icon-img'
        } else {
          // provide a default icon type
          $iconItem = $('<i />')
          iconClass = 'fas fa-cube sp-icon-desktop'
        }
        $iconItem.prop('class', iconClass)

        var $nameItem = $('<div />')
        $nameItem.prop('class', 'sp-session-link-type')
        $nameItem.html(this.type)

        $anchorItem.append($iconItem)
        $anchorItem.append($nameItem)

        $linkItem.append($anchorDiv)
        $itemContainer.append($linkItem)
        $listItem.append($itemContainer)
        $unorderedList.append($listItem)
      })

      $sessionListDiv.append($unorderedList)
      $('.sp-session-connect').on('click', handleConnectRequest)
      $('.sp-session-delete').on('click', handleDeleteSession)
    }

    /**
     * This function provides a default session name that integrates
     * the number of sessions of that type. Name can be overridden by user
     * in the launch form.
     * @param sessionType
     */
    function setSessionName(sessionType) {
      var sessionName = portalSessions.getDefaultSessionName(sessionType)
      $('#sp_session_name').val(sessionName)
    }

    function setFormFields(sessionType) {
      // go through _sessionTypeMap.session_types
      var formList = []
      for (var i = 0; i < _sessionTypeMap.session_types.length; i++) {
        if (_sessionTypeMap.session_types[i].name === sessionType) {
          formList = _sessionTypeMap.session_types[i].form_fields
          break
        }
       }

      // go through full form list, and if an item in the full list
      // is not included in type formList, then set it to hidden. otherwise show it
      for (var j = 0; j < _launchFormFields.length; j++) {
        if (formList.indexOf(_launchFormFields[j]) == -1) {
          $('.sp-form-' + _launchFormFields[j]).addClass('hidden')
        } else {
          $('.sp-form-' + _launchFormFields[j]).removeClass('hidden')
        }
      }

    }

    function setSelectedType(sessionType) {
      var $selectToChange = $('#' + selectID)

      // Go through options until current is found, add or remove selected attribute
    }

    function populateSelect(selectID, optionData, placeholderText, defaultOptionID) {
      var $selectToAugment = $('#' + selectID)

      // Clear select content first
      $selectToAugment.empty()

      if (typeof optionalDefault == 'undefined') {
        // Add given placeholder text
        $selectToAugment.append('<option value="" selected disabled>' + placeholderText + '</option>')
      }

      // Build new list
      $(optionData).each(function () {
        var option = $('<option />')
        option.val(this.optionID)
        if (this.optionID == defaultOptionID ) {
          option.prop('selected', true)
        }
        option.html(this.name)
        $selectToAugment.append(option)
      });
    }


    function checkForSessions() {
      portalCore.setInfoModal('Session Check', 'Grabbing session list', false, false)
      // This is an ajax function that will fire either onFindSessionOK or onFindSessionFail
      // and listeners to those will respond accordingly
      portalCore.clearAjaxAlert()
      portalCore.setProgressBar('busy')
      portalSessions.loadSessionList()
    }


    // ------------ Event Handlers ------------

    /**
     * Instead of going directly to the session, check to make sure it's in 'Running' state first.
     * @param curSession
     */
    function handleConnectRequest(event, data) {
      event.preventDefault()
      // Pull data-* information from anchor element
      var sessionData = $(event.currentTarget).data()
      if (portalSessions.isRunningSession(sessionData)) {
        portalCore.setProgressBar('okay')
        portalCore.setInfoModal('Connecting to Session', 'Connecting to existing session ' + sessionData.name
          + ' (' + sessionData.id + ')', false, false)
        // just forward people to next page, in this same window
        window.open(sessionData.connecturl, '_blank')
        // Note: the modal just opened is left up. It's not clear if that's he best behaviour,
        // but after it's used some we'll get feedback on how better to handle it
      } else {
        portalCore.setProgressBar('error')
        // TODO: should be able to close this modal?
        portalCore.setInfoModal('Can\'t connect to session', 'An existing session was found, but is not running. (' +
          sessionData.status + '). Try again in a few moments, or contact CANFAR admin for assistance.',
          true, false, false);
      }
    }

    /**
     * Triggered from 'Reload' button on info modal
     */
    function handlePageRefresh() {
      window.location.reload()
    }

    function showLaunchForm(show) {
      if (show === true) {
        $('#sp_launch_form_div').removeClass('hidden')
      } else {
        $('#sp_launch_form_div').addClass('hidden')
      }
    }

    /**
     * Triggered from '+' button on session list button bar
     */
    function handleAddSession() {
      // Get supported session type list & populate dropdown (ajax)
      // Triggers setting the launch form to defaults
      loadTypeMap()

      // Show the launch form
      showLaunchForm(true)
    }

    /**
     * Triggered from '-' button on session list button bar
     */
    function handleDeleteSession(event) {
      var sessionData = $(event.currentTarget).data()
      portalCore.setInfoModal("Delete Request", "Deleting session " + sessionData.name + ", id " + sessionData.id, false, false, true)
      portalSessions.deleteSession(sessionData.id)
    }


    // ------------ HTTP/Ajax functions & event handlers ------------
    // ---------------- POST ------------------

    /**
     * Submit button function
     * @param event
     */
    function handleSessionRequest(event) {
      // Stop normal form submit
      event.preventDefault()
      portalCore.clearAjaxAlert()
      var formData = gatherFormData()

      portalCore.setInfoModal('Requesting Session', 'Requesting new session', false, true, true)
      Promise.resolve(postSessionRequestAjax(portalCore.sessionServiceURL.session, formData))
        .then(function(sessionInfo) {
          portalCore.setProgressBar('okay')
          portalCore.hideInfoModal(true)
          portalCore.trigger(_selfPortalApp, cadc.web.science.portal.events.onSessionRequestOK, sessionInfo)
        })
        .catch(function(request) {
          portalCore.handleAjaxError(request)
        })
    }

    function postSessionRequestAjax(serviceURL, sessionData) {
      return new Promise(function (resolve, reject) {
        var request = new XMLHttpRequest()

        // 'load' is the XMLHttpRequest 'finished' event
        request.addEventListener(
          'load',
          function () {
            if (request.status === 200) {
              // Session ID and data from server not returned with
              // this request. Use the name & type posted in form
              // to identify this request going forward
              resolve({"name": sessionData.get("name"), "type": sessionData.get("type")})
            } else if (request.status === 400) {
              reject(request)
            }
          },
          false
        )
        // withCredentials enables cookies to be sent
        // Note: SameSite cookie header isn't set with this method,
        // may cause problems with Chrome and other browsers? Feb 2021
        request.withCredentials = true
        request.open('POST', serviceURL)
        request.send(sessionData)
      }) // end Promise

    }

    // Used in POST for /session endpoint
    function gatherFormData() {
      var _formdata = $('#session_request_form').serializeArray()
      var _prunedFormData = new FormData();

      _formdata.forEach(function(currentValue, index, arr) {
        _prunedFormData.append(currentValue.name, currentValue.value)
      })
      return _prunedFormData
    }


    // ---------------- GETs ----------------
    // ------- Dropdown Ajax functions

    /**
     * Get the a map of help text and headers from the content file
     * @private
     */
    function loadTypeMap() {
      var contentFileURL = 'json/sessiontype_map_en.json'

      // Using a json input file because it's anticipated that the
      // number of sessions will increase fairly soon.
      $.getJSON(contentFileURL, function (jsonData) {
        _sessionTypeMap = jsonData

        // parse out the option data
        var tempTypeList = new Array()
        for (var i = 0; i < _sessionTypeMap.session_types.length; i++) {
          // each entry has id, type, digest, only 'id' is needed
          tempTypeList.push({name: _sessionTypeMap.session_types[i].name, optionID: _sessionTypeMap.session_types[i].name})
        }

        populateSelect('sp_session_type', tempTypeList, 'select type',_sessionTypeMap.default)

        // notebook is default
        setLaunchFormForType(_sessionTypeMap.default)
      })
    }

    function setLaunchFormForType(sessionType) {
      loadContainerImages(sessionType)
      // reload context values whether they are displayed or not
      loadContext()
      setSessionName(sessionType)
      setFormFields(sessionType)
    }

    function loadContainerImages(sessionType) {
      portalCore.setInfoModal('Loading Container Images', 'Getting container list', false, true, true)
      portalCore.clearAjaxAlert()
      portalCore.setProgressBar('busy')

      Promise.resolve(getImageListAjax(portalCore.sessionServiceURL.images + '?type=' + sessionType, {}))
        .then(function(imageList) {
          portalCore.hideInfoModal(true)
          portalCore.setProgressBar('okay')

          if (imageList.length > 0) {

            var cores = imageList.availableCores
            var tempImageList = new Array()
            for (var i = 0; i < imageList.length; i++) {
              // each entry has id, type, digest, only 'id' is needed
              tempImageList.push({name: imageList[i].id, optionID: imageList[i].id})
            }
            // Make the first entry be default until something else is decided
            populateSelect('sp_software_stack', tempImageList, 'select stack', tempImageList[0].name)
          } else {
            portalCore.setInfoModal('No Images found','No public container images found for your username.',
              true, false, false)
          }

        })
        .catch(function(message) {
          var msgStr =  portalCore.getRcDisplayTextPlusCode(message)
          portalCore.setProgressBar('error')
          portalCore.setInfoModal('Problem loading container images', 'Problem loading container image list. '
            + 'Try to reset the form to reload. ' + msgStr, true, false, false)
        })
    }

    function getImageListAjax(serviceURL, sessionData) {
      return new Promise(function (resolve, reject) {
        var request = new XMLHttpRequest()

        // 'load' is the XMLHttpRequest 'finished' event
        request.addEventListener(
          'load',
          function () {
            if (request.status === 200) {
              var jsonData = portalCore.parseJSONStr(request.responseText)
              resolve(jsonData)
            } else {
              reject(request)
            }
          },
          false
        )
        // withCredentials enables cookies to be sent
        // Note: SameSite cookie header isn't set with this method,
        // may cause problems with Chrome and other browsers? Feb 2021
        request.withCredentials = true
        request.open('GET', serviceURL)
        request.send(null)
      })
    }

    function loadContext() {
      // go to /context endpoint and then populate the sp_cores and sp_memory dropdowns
      portalCore.setInfoModal('Loading Context Resources', 'Getting current context resources',
        false, true, true)

      portalCore.clearAjaxAlert()
      portalCore.setProgressBar('busy')

      var tmpServiceURL = portalCore.sessionServiceURL.context

      Promise.resolve(getCurrentContextAjax(tmpServiceURL, {}))
        .then(function(curContext) {
          portalCore.hideInfoModal(true)
          portalCore.setProgressBar('okay')

          var cores = curContext.availableCores
          var tempCoresSelectData = new Array()
          for (var i=0; i< cores.length; i++) {
            tempCoresSelectData.push({name: cores[i], optionID: cores[i]})
          }
          populateSelect('sp_cores', tempCoresSelectData, 'select # cores', curContext.defaultCores)

          var memory = curContext.availableRAM
          var tempMemorySelectData = new Array()
          for (var i=0; i< memory.length; i++) {
            tempMemorySelectData.push({name: memory[i], optionID: memory[i]})
          }
          populateSelect('sp_memory', tempMemorySelectData, 'select RAM', curContext.defaultRAM)
        })
        .catch(function(message) {
          portalCore.setInfoModal('Problem Loading Context', 'Problem loading server context resources. '
            + 'Reload page to try again.', true, false, false)
          portalCore.handleAjaxError(message)
        })
    }

    function getCurrentContextAjax(serviceURL, sessionData) {
      return new Promise(function (resolve, reject) {
        var request = new XMLHttpRequest()

        // 'load' is the XMLHttpRequest 'finished' event
        request.addEventListener(
          'load',
          function () {
            if (request.status === 200) {
              var jsonData = portalCore.parseJSONStr(request.responseText)
              resolve(jsonData)
            } else {
              reject(request)
            }
          },
          false
        )
        // withCredentials enables cookies to be sent
        // Note: SameSite cookie header isn't set with this method,
        // may cause problems with Chrome and other browsers? Feb 2021
        request.withCredentials = true
        request.open('GET', serviceURL)
        request.send(null)
      }) // end Promise
    }

    function handleResetFormState(event) {
      event.preventDefault()
      // Clear messages
      portalCore.clearAjaxAlert()
      portalCore.setProgressBar('okay')

      // set selected back to session type default
      $("#sp_session_type option").each(function() {
        if ($(this).val() == _sessionTypeMap.default) {
          $(this).attr('selected','selected')
        } else {
          $(this).removeAttr('selected')
        }
      });

      // reload the form for default session type
      setLaunchFormForType(_sessionTypeMap.default)
    }

    $.extend(this, {
      init: init
    })
  }

})(jQuery)
