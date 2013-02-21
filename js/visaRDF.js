// das Semikolon vor dem Funktions-Aufruf ist ein Sicherheitsnetz f�r verkettete
// Scripte und/oder andere Plugins die m�glicherweise nicht ordnungsgem�� geschlossen wurden.
;
(function($, window, document, undefined) {

	// Add visaRdf stylesheet
	$(document).ready(function() {
		$('head').append('<link rel="stylesheet" href="css/visaRdf.css" type="text/css" />');
	});

	// Default options
	var pluginName = "visaRDF", $window = $(window), defaults = {
		data : undefined,
		dataLoc : undefined,
		dataFormat : undefined,
		templatesPath : "templates/templates.html",
		batchSize : 25,
		generateSortOptions : true,
		generateFilterOptions : false,
		filterBy : [ {
			value : "*",
			label : "showAll"
		} ],
		sparqlData : undefined,
		elementStyle : {
			dimension : {
				width : 200,
				height : 100
			},
			colors : [ '#e2674a', '#99CC99', '#3399CC', '#33CCCC', '#996699', '#C24747', '#FFCC66', '#669999', '#CC6699', '#339966', '#666699' ]
		},
		ns : {
			'rdf' : 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
			'rdfs' : 'http://www.w3.org/2000/01/rdf-schema#',
			'owl' : 'http://www.w3.org/2002/07/owl#',
			'rif' : 'http://www.w3.org/2007/rif#',
			'foaf' : 'http://xmlns.com/foaf/0.1/',
			'dbpedia' : 'http://dbpedia.org/resource/',
			'dbpedia-owl' : 'http://dbpedia.org/ontology/',
			'dbpprop' : 'http://dbpedia.org/property/',
			'geo' : 'http://www.w3.org/2003/01/geo/wgs84_pos#',
			'dc' : 'http://purl.org/dc/terms/'
		},
		rdfstoreOptions : {
			persistence : true,
			name : '',
			overwrite : true,
			engine : '',
			engineData : {
				mongoDomain : '',
				mongoPort : '',
				mongoOptions : {}
			}
		},
		isotopeOptions : {
			sortBy : 'number',
			getSortData : {
				number : function($elem) {
					var number = $elem.hasClass('element') ? $elem.find('.number').text() : $elem.attr('data-number');
					return parseInt(number, 10);
				},
				alphabetical : function($elem) {
					var labelEn = $elem.find('.labelEn'), itemText = labelEn.length ? labelEn : $elem;
					return itemText.text();
				}
			}
		}
	},

	// rdfStore instance(SPARQL endpoint)
	rdfStore,

	// handlebars templates for the plugin
	templates = {},

	// Deferred to inform if the plugin was already initialized once
	globalInitDfd = undefined,

	// Counter for plugin instances
	pluginInstanceCount = 0,

	// currentLevel
	currentLevel = 0,

	CSS_CLASSES = {
		outerContainer : "outerContainer",
		isotopeContainer : "container",
		options : "options",
		clearfix : "clearfix",
		loader : "loading",
		preview : "preview",
		previewContent : "previewContent",
		overlay : "overlay",
		overlayContent : "overlayContent",
		typeClasses : {
			incoming : "incoming",
			outgoing : "outgoing"
		},
		toSelector : function(id) {
			return "." + this[id];
		}
	},

	// Placeholder in query strings
	DUMMY = "#replaceMe#",

	// Event types for Pub/Sub system
	EVENT_TYPES = {
		storeModified : {
			insert : "dataInsert"
		},
		loading : {
			loadingDone : "loadingDone",
			loadingStart : "loadingStarted"
		}
	},

	MESSAGES = {
		error : {
			ajax : "Error on loading data."
		}
	};

	// <---- class private utility functions ---->
	function isUndefinedOrNull(a) {
		return ((typeof a === "undefined") || (a === null));
	}

	function replaceDummy(query, replacement) {
		return query.replace(new RegExp(DUMMY, "g"), replacement);
	}

	function getWindowSize(withoutScrollbar) {
		var w = null, h = null;
		if (withoutScrollbar) {
			if (that._$body.hasClass('noscroll')) {
				w = $window.width(), h = $window.height();
			} else {
				that._$body.addClass('noscroll');
				w = $window.width(), h = $window.height();
				that._$body.removeClass('noscroll');
			}
		} else {
			w = $window.width(), h = $window.height();
		}
		return {
			width : w,
			height : h
		};
	}

	function getClip(name) {
		switch (name) {
		case CSS_CLASSES.preview:
			var winsize = getWindowSize(false);
			return 'rect(' + winsize.height * 0.25 + 'px ' + winsize.width * 0.75 + 'px ' + winsize.height * 0.75 + 'px ' + winsize.width * 0.25 + 'px)';
			break;
		case CSS_CLASSES.overlay:
			var winsize = getWindowSize(true);
			return 'rect(0px ' + winsize.width + 'px ' + winsize.height + 'px 0px)';
			break;
		default:
			console.log("No clip data found.");
			return "";
		}
	}

	function getItemLayoutProp($item) {
		var scrollT = $window.scrollTop(), scrollL = $window.scrollLeft(), itemOffset = $item.offset();
		return {
			left : itemOffset.left - scrollL,
			top : itemOffset.top - scrollT,
			width : $item.outerWidth(),
			height : $item.outerHeight()
		};
	}

	function getTransData() {
		var transEndEventNames = {
			'WebkitTransition' : 'webkitTransitionEnd',
			'MozTransition' : 'transitionend',
			'OTransition' : 'oTransitionEnd',
			'msTransition' : 'MSTransitionEnd',
			'transition' : 'transitionend'
		};
		// transition end event name
		return {
			"transEndEventName" : transEndEventNames[Modernizr.prefixed('transition')],
			"transSupport" : Modernizr.csstransitions
		};
	}
	// <!--- class private utility functions ---->

	// JQuery custom selector expression
	$.expr[':']['class-prefix'] = function(elem, index, match) {
		var prefix = match[3];

		if (!prefix)
			return true;

		var sel = '[class^="' + prefix + '"], [class*=" ' + prefix + '"]';
		return $(elem).is(sel);
	};

	// Plugin constructor
	function Plugin(element, options) {
		// <---- private utility functions ---->
		/**
		 * Uses $.proxy() to overwrite the context of a given function with the
		 * widget context.
		 * 
		 * @arguments
		 * @param {Function}
		 *            fn Function to modifie
		 * @return function with modified context
		 */
		this._selfProxy = function(fn) {
			return $.proxy(fn, this);
		};
		// <!--- instance private utility functions ---->

		this._$body = $('BODY'), this._$element = $(element);
		this._$outerContainer = $('<div class="' + CSS_CLASSES.outerContainer + '"></div>');
		this._$isotopeContainer = $('<div class="' + CSS_CLASSES.isotopeContainer + '"></div>');
		this._$element.append(this._$outerContainer);
		this._$outerContainer.append(this._$isotopeContainer);

		pluginInstanceCount++;
		// Give parentelement of the plugin a correspondending plugin class
		this._$element.addClass(pluginName + "_" + pluginInstanceCount);
		this._instanceNumber = pluginInstanceCount;
		this._instanceLevel = currentLevel;

		// Use $.extend to merge the plugin options element with the defaults
		this.options = $.extend({}, defaults, options);
		this._defaults = defaults;
		this._name = pluginName;

		this._expandedOverlaysCount = 0;

		// List of added items. Holds only uri and index of an item.
		this._itemHistory = {
			length : 0
		};

		// Prefixes for SPARQL queries variable
		this._prefixes = "";

		// SPARQL query variable
		this._queries = {};

		// <---- private functions ---->
		this._initTemplating = this._selfProxy(function() {
			var that = this, templateInitDfd = $.Deferred();

			// Helper to iterate over keys of given context
			Handlebars.registerHelper('keysEach', function(context, options) {
				var out = '';
				for ( var key in context) {
					out += options.fn(key);
				}
				return out;
			});

			// Helper to add elements, needs current plugin context
			Handlebars.registerHelper('historyAwareEach', function(context, options) {
				var fn = options.fn;
				var i = 0, ret = "", data;

				if (options.data) {
					data = Handlebars.createFrame(options.data);
				}

				if (context && typeof context === 'object') {
					if (context instanceof Array) {
						for ( var j = context.length; i < j; i++) {
							// console.log(context)
							switch (context[i].subject.token) {
							case 'uri':
								var currentUri = context[i].subject.value;

								// If element isn't already created, create it
								if (!(currentUri in context.plugin._itemHistory)) {
									if (context[i].label) {
										if (context[i].label.lang === undefined || context[i].label.lang === "en") {

											// increment index and give it back
											// to
											// the template
											if (data) {
												context[i].index = data.index = context.plugin._itemHistory.length++;
											}
											ret = ret + fn(context[i], {
												data : data
											});

											// Save added item in history
											context.plugin._itemHistory[currentUri] = context[i];
										}
									}
								} else {

									// Check for element update
									var update = false;
									$.each(context[i], function(i, val) {
										if (val !== null) {
											if (context.plugin._itemHistory[currentUri][i] === null) {
												context.plugin._itemHistory[currentUri][i] = val;
												update = true;
											} else if (i === "type" && context.plugin._itemHistory[currentUri][i] !== context[i]) {

												// An element can have more than
												// one
												// type
												context.plugin._itemHistory[currentUri][i].value += " " + val.value;
												update = true;
											}
										}
									});

									// Update element if needed
									if (update) {
										data.index = context.plugin._itemHistory[currentUri].index;

										// If element isn't already added we
										// need to
										// remove it from ret
										$tempDiv = $('<div/>').append(ret);
										$tempDiv.remove("." + context.plugin._itemHistory[currentUri].index);
										ret = $tempDiv.contents();

										// If element is already added we need
										// to
										// remove it from isotope
										$(context.plugin._$isotopeContainer).isotope("remove",
												$(context.plugin._$isotopeContainer).find("." + context.plugin._itemHistory[currentUri].index));

										ret = ret + fn(context.plugin._itemHistory[currentUri], {
											data : data
										});
									}
								}
								break;
							case 'literal':
								// increment index and give it back
								// to
								// the template
								if (data) {
									context[i].index = data.index = context.plugin._itemHistory.length++;
								}
								ret = ret + fn(context[i], {
									data : data
								});
							}
						}
					}
				}
				return ret;
			});

			// Helper to check if language of given context is undefined or "en"
			Handlebars.registerHelper('ifLang', function(context, options) {
				if (context && (context.lang === undefined || context.lang === "en")) {
					return options.fn(this);
				}
			});

			// Get external template file
			$.get(that.options.templatesPath, function(data) {
				$('HEAD').append(data);

				// <--- extract templates --->
				templates.isoEle = Handlebars.compile($("#visaRDF-isotope-elements").html());
				Handlebars.registerPartial("visaRDF-isotope-element", $("#visaRDF-isotope-element").html());
				templates.overlayEle = Handlebars.compile($("#visaRDF-overlay-element").html());
				templates.overlayCon = Handlebars.compile($("#visaRDF-overlay-content").html());
				templates.sortOptions = Handlebars.compile($("#visaRDF-sort-options").html());
				templates.filterOptions = Handlebars.compile($("#visaRDF-filter-options").html());
				templates.previewEle = Handlebars.compile($("#visaRDF-preview-element").html());
				// <!-- extract templates --->

				templateInitDfd.resolve();
			}, "html");
			return templateInitDfd.promise();
		});

		// History of event handler bindings
		this._evHandlerHistory = {};

		this._addEventHandler = this._selfProxy(function(eventType, handler, object) {
			var that = this;
			if (object === undefined) {
				object = that._$element.children(CSS_CLASSES.toSelector('outerContainer'));
			}
			if (that._evHandlerHistory[eventType] === undefined) {
				that._evHandlerHistory[eventType] = [];
			}
			that._evHandlerHistory[eventType].push({
				"object" : object,
				"handler" : handler
			});
			object.on(eventType, handler);
		});

		this._initBrowsability = this._selfProxy(function($items) {
			var that = this, transData = getTransData(),
			// transition end event name
			transEndEventName = transData.transEndEventName,
			// transitions support available?
			supportTransitions = transData.transSupport;

			$items.each(function() {
				var $item = $(this);

				$item.index = parseInt($item.find('.number').html());
				// <---- item click event ---->
				that._addItemClickEvent($item, supportTransitions, transEndEventName);
				// <!--- item click event ---->
			});
		});

		this._addItemClickEvent = this._selfProxy(function($item, supportTransitions, transEndEventName) {
			var that = this;
			that._addEventHandler('click', function(e) {

				/*
				 * Stop propagation to not trigger window click event which
				 * closes preview again
				 */
				e.stopPropagation();

				// If preview isn't added already
				that._addPreview($item, supportTransitions, transEndEventName, function($preview) {

					// <!--- preview show ---->
					var layoutProp = getItemLayoutProp($item), itemClip = 'rect(' + layoutProp.top + 'px ' + (layoutProp.left + layoutProp.width) + 'px '
							+ (layoutProp.top + layoutProp.height) + 'px ' + layoutProp.left + 'px)', previewClip = getClip(CSS_CLASSES.preview);

					// Make preview visible
					$preview.css({
						clip : supportTransitions ? itemClip : previewClip,
						opacity : 1,
						zIndex : 9998,
						pointerEvents : 'auto'
					});

					if (supportTransitions) {
						$preview.on(transEndEventName, function() {
							$preview.off(transEndEventName);

							setTimeout(function() {
								$preview.css('clip', previewClip).on(transEndEventName, function() {
									$preview.off(transEndEventName);
								});
							}, 25);

						});
					}
					// <!--- preview show ---->

				});
			}, $item);
		});

		this._addPreview = this._selfProxy(function($item, supportTransitions, transEndEventName, callback) {

			var that = this, $previews = $(CSS_CLASSES.toSelector("preview"));
			var $preview = $previews.filter(CSS_CLASSES.toSelector("preview") + '_' + $item.index);
			$previews.not($preview).css({
				opacity : 0,
				pointerEvents : 'none',
				zIndex : -1,
				clip : 'auto'
			});
			if ($preview.length < 1) {
				preview = templates.previewEle({
					"index" : $item.index,
					"cssClass" : {
						"preview" : CSS_CLASSES.preview,
						"previewContent" : CSS_CLASSES.previewContent
					}
				});
				that._$element.append(preview);
				$preview = that._$element.find('> ' + CSS_CLASSES.toSelector("preview") + '_' + $item.index);
				$preview.css('background-color', $item.css('background-color'));
				$previewContent = $preview.children(CSS_CLASSES.toSelector("previewContent"));
				$previewContent.text("" + $item.find('.labelEn > div').html());

				// <---- Add event on window click ---->
				that._addPreviewCloseEvent($item, $preview, supportTransitions, transEndEventName);
				// <!--- Add event on window click ---->

				// <---- preview click Event ---->
				that._addPreviewClickEvent($item, $preview, supportTransitions, transEndEventName);
				// <!--- preview click Event ---->
				callback($preview);
			} else {
				callback($preview);
			}
		});

		this._addPreviewCloseEvent = this._selfProxy(function($item, $preview, supportTransitions, transEndEventName) {
			var that = this;
			that._addEventHandler('click', function(that) {
				if (that._instanceLevel === currentLevel) {
					var layoutProp = getItemLayoutProp($item), itemClip = 'rect(' + layoutProp.top + 'px ' + (layoutProp.left + layoutProp.width) + 'px '
							+ (layoutProp.top + layoutProp.height) + 'px ' + layoutProp.left + 'px)';

					$preview.css({
						opacity : 1,
						pointerEvents : 'none',
						clip : itemClip
					});

					if (supportTransitions) {
						$preview.on(transEndEventName, function() {
							$preview.off(transEndEventName);
							setTimeout(function() {
								$preview.css('opacity', 0).on(transEndEventName, function() {
									$preview.off(transEndEventName).css({
										clip : 'auto',
										zIndex : -1
									});
									$item.data('isExpanded', false);
								});
							}, 25);

						});
					} else {
						$preview.css({
							opacity : 0,
							zIndex : -1
						});
					}
				}
			}, $window);
		});

		this._addPreviewClickEvent = this._selfProxy(function($item, $preview, supportTransitions, transEndEventName) {
			var that = this;
			that._addEventHandler('click', function(e) {

				if (!$item.data('isExpanded')) {
					$item.data('isExpanded', true);

					// increment overall level
					if (that._instanceLevel === currentLevel) {
						currentLevel++;
					}

					// increment Counter (only needed if more than 1 Overlay can
					// be opened)
					that._expandedOverlaysCount++;

					// Add overlay if needed
					that._addOverlay($item, supportTransitions, transEndEventName, function($overlay) {

						// Fill overlay with content
						that._initOverlayContent($item, $overlay, function() {
							// <---- overlay show function ---->
							var previewClip = getClip(CSS_CLASSES.preview), overlayClip = getClip(CSS_CLASSES.overlay);

							// Make overlay visible
							$overlay.css({
								clip : supportTransitions ? previewClip : overlayClip,
								opacity : 1,
								zIndex : 9999,
								pointerEvents : 'auto'
							});

							if (supportTransitions) {
								$overlay.on(transEndEventName, function() {

									$overlay.off(transEndEventName);

									setTimeout(function() {
										$overlay.css('clip', overlayClip).on(transEndEventName, function() {
											$overlay.off(transEndEventName);
											that._$body.addClass('noscroll');
										});
									}, 25);

								});
							} else {
								that._$body.addClass('noscroll');
							}
							// <!--- overlay show function ---->
						});
					});
				}

				// <---- hide preview and deactivate transitions
				// ---->
				$preview.css({
					opacity : 0,
					pointerEvents : 'none',
					zIndex : -1,
					clip : 'auto'
				});
				// <!--- hide preview and deactivate transitions
				// ---->
			}, $preview);
		});

		this._addOverlay = this._selfProxy(function($item, supportTransitions, transEndEventName, callback) {
			var that = this, $overlay = that._$element.find('> ' + CSS_CLASSES.toSelector("overlay") + '_' + $item.index);
			if ($overlay.length < 1) {
				var overlay = templates.overlayEle({
					"index" : $item.index,
					"cssClass" : {
						"overlay" : CSS_CLASSES.overlay,
						"overlayContent" : CSS_CLASSES.overlayContent
					}
				});
				that._$element.append(overlay);
				$overlay = that._$element.find('> ' + CSS_CLASSES.toSelector("overlay") + '_' + $item.index);

				// <---- close click Event ---->
				that._addOverlayCloseEvent($item, $overlay, supportTransitions, transEndEventName);
				// <!--- close Event ---->
				callback($overlay);
			} else {
				callback($overlay);
			}
		});

		this._addOverlayCloseEvent = this._selfProxy(function($item, $overlay, supportTransitions, transEndEventName) {
			var that = this, $overlayContent = $overlay.find('> ' + CSS_CLASSES.toSelector("overlayContent")), $close = $overlay.find('> span.close');
			that._addEventHandler('click', function() {

				that._expandedOverlaysCount--;
				if (that._expandedOverlaysCount === 0) {
					if (--currentLevel === 0) {
						that._$body.removeClass('noscroll');
					}
				}

				var layoutProp = getItemLayoutProp($item), itemClip = 'rect(' + layoutProp.top + 'px ' + (layoutProp.left + layoutProp.width) + 'px '
						+ (layoutProp.top + layoutProp.height) + 'px ' + layoutProp.left + 'px)';

				$overlay.css({
					clip : itemClip,
					opacity : 1,
					pointerEvents : 'none'
				});

				// <---- overlay hide ---->
				// clear old data
				$overlayContent.find('div:class-prefix(visaRDF)').data('plugin_visaRDF').destroy();
				$overlayContent.children().remove('');

				if (supportTransitions) {
					$overlay.on(transEndEventName, function() {
						$overlay.off(transEndEventName);
						setTimeout(function() {
							$overlay.css('opacity', 0).on(transEndEventName, function() {
								$overlay.off(transEndEventName).css({
									clip : 'auto',
									zIndex : -1
								});
								$item.data('isExpanded', false);
							});
						}, 25);

					});
				} else {
					$overlay.css({
						opacity : 0,
						zIndex : -1
					});
				}
				// <!--- overlay hide ---->
			}, $close);
		});

		this._initOverlayContent = this._selfProxy(function($item, $overlay, callback) {
			var that = this, $overlayContent = $overlay.find('> ' + CSS_CLASSES.toSelector("overlayContent"));

			// Get elements who are in a relation to
			// current item
			var subjectOfQuery = replaceDummy(that._queries.selectSubjectOf, $item.find('.showUri').html()), objectOfQuery = replaceDummy(
					that._queries.selectObjectOf, $item.find('.showUri').html());

			that._rdfStoreExecuteQuery(subjectOfQuery, function(subjectOf) {
				that._rdfStoreExecuteQuery(objectOfQuery, function(objectOf) {

					// console.log(subjectOf);

					// Input for the handlebar
					// template
					var input = {};
					if (subjectOf[0] && subjectOf[0].origin) {
						input.label = subjectOf[0].origin.value;
					} else if (objectOf[0] && objectOf[0].origin) {
						input.label = objectOf[0].origin.value;
					}

					// Add types for filtering
					for ( var i = 0; i < subjectOf.length; i++) {
						subjectOf[i].type = {
							value : CSS_CLASSES.typeClasses.outgoing
						};
					}
					for ( var i = 0; i < objectOf.length; i++) {
						objectOf[i].type = {
							value : CSS_CLASSES.typeClasses.incoming
						};
					}

					// write new data
					$overlayContent.append($(templates.overlayCon(input)));

					var resultSet = $.merge($.merge([], subjectOf), objectOf);
					$overlayContent.find('> .innerScroll > div').visaRDF($.extend(true, {}, that.options, {
						dataLoc : null,
						dataFormat : null,
						sparqlData : resultSet,
						generateSortOptions : true,
						generateFilterOptions : true,
						isotopeOptions : {
							getSortData : {
								number : function($elem) {
									var number = $elem.hasClass('element') ? $elem.find('.number').text() : $elem.attr('data-number');
									return parseInt(number, 10);
								},
								alphabetical : function($elem) {
									var labelEn = $elem.find('.labelEn'), itemText = labelEn.length ? labelEn : $elem;
									return itemText.text();
								},
								type : function($elem) {
									var classes = $elem.attr("class");
									return classes;
								}
							}
						},
						filterBy : [ {
							value : "*",
							label : "showAll"
						}, {
							value : CSS_CLASSES.typeClasses.incoming,
							label : "in"
						}, {
							value : CSS_CLASSES.typeClasses.outgoing,
							label : "out"
						} ],
					}));
				});
			});
			// Set contet color
			var color = new RGBColor($item.css("background-color"));
			$overlay.css("background-color", color.toRGB());
			$.each($overlayContent.children('div'), function(i, val) {
				color.r -= 10;
				color.b -= 10;
				color.g -= 10;
				$(val).css("background", color.toRGB());
			});

			// Set content width
			$overlayContent.find('> .overlayColumn').css("width", 100 + "%");

			// Set innerScrollBox width and height
			$overlayContent.find('.innerScroll').css("width",
					($window.width() - parseInt($overlay.css("padding-left")) - parseInt($overlay.css("padding-right"))) + "px");
			$overlayContent.find('.innerScroll').css("height", $window.height() * 0.95 + "px");

			callback();
		});

		this._initRdfStore = this._selfProxy(function() {
			var that = this, rdfStoreInitDfd = $.Deferred();
			// console.log("Init RDFSTORE");
			if (isUndefinedOrNull(rdfStore)) {
				new rdfstore.Store(that.options.rdfstoreOptions, that._selfProxy(function(store) {
					rdfStore = store;
					rdfStoreInitDfd.resolve();
				}));
			}
			return rdfStoreInitDfd.promise();
		});

		this._initQueries = this
				._selfProxy(function() {
					var that = this;
					// Generate prefixes for SPARQL queries by using namesspaces
					// given in
					// options
					$.each(this.options.ns, this._selfProxy(function(i, val) {
						that._prefixes += "PREFIX " + i + ": <" + val + "> ";
					}));

					// Generate SPARQL queries
					this._queries = {
						initQuery : that._prefixes
								+ " SELECT ?subject ?label ?description ?type WHERE { ?subject rdfs:label ?label . OPTIONAL { ?subject rdfs:description ?description } . OPTIONAL { ?subject rdfs:comment ?description }. OPTIONAL {?subject rdfs:type ?type}}",
						selectSubjectOf : that._prefixes
								+ " SELECT ?subject ?label ?description ?origin WHERE {<"
								+ DUMMY
								+ "> ?x ?subject. <"
								+ DUMMY
								+ "> rdfs:label ?origin. OPTIONAL { ?subject rdfs:label ?label}. OPTIONAL { ?subject rdfs:description ?description } . OPTIONAL { ?subject rdfs:comment ?description }}",
						selectObjectOf : that._prefixes
								+ " SELECT ?subject ?label ?description ?origin WHERE {?subject ?x <"
								+ DUMMY
								+ ">. <"
								+ DUMMY
								+ "> rdfs:label ?origin. OPTIONAL { ?subject rdfs:label ?label}. OPTIONAL { ?subject rdfs:description ?description } . OPTIONAL { ?subject rdfs:comment ?description }}"
					};
				});

		this._isotopeAddBatches = this._selfProxy(function(items) {
			var length = items.length, that = this, batchSize = ((length < that.options.batchSize) ? length : that.options.batchSize);

			this._$outerContainer.find('> .loading').text(parseInt(batchSize / length * 100) + "% -");

			// current batch
			var batch = items.slice(0, batchSize);

			// isoEle / HistoryAwareEach needs plugincontext
			batch.plugin = that;

			$.each(batch, function(i, val) {
				// use literal value as label on literals
				if (val.subject.token === "literal") {
					val.label = val.subject;
				}
			});
			// console.log(batch)

			var $elements = $(templates.isoEle(batch));
			// console.log($elements)
			$.each($elements, function(i, val) {
				$(val).css("background-color", "rgba(125, 125, 125 ,0.2)");
			});

			if (!isUndefinedOrNull($elements.html())) {

				// Use given width/height
				$elements.css({
					width : this.options.elementStyle.dimension.width,
					height : this.options.elementStyle.dimension.height
				});

				that._$isotopeContainer.isotope('insert', $elements, function() {
					$elements.find('.ellipsis').ellipsis();
					$nodes = $elements.filter('.token_uri');
					$literals = $elements.filter('.token_literal');

					// Init overlays on new elements
					that._initBrowsability($nodes);
					$.each($nodes, function(i, val) {
						var color = new RGBColor(that.options.elementStyle.colors[i % that.options.elementStyle.colors.length]);
						$(val).css("background-color", "rgba(" + color.r + ", " + color.g + ", " + color.b + " ,1)");
					});
					$.each($literals, function(i, val) {
						$(val).css("background-color", "rgba(" + 125 + ", " + 125 + ", " + 125 + " ,1)");
					});

					that._isotopeAddBatchesHelp(items, batchSize);
				});
			} else {
				that._isotopeAddBatchesHelp(items, batchSize);
			}
		});

		this._isotopeAddBatchesHelp = this._selfProxy(function(items, batchSize) {
			var that = this, rest = items.slice(batchSize);
			if (rest.length > 0) {
				that._isotopeAddBatches(rest);
			} else {
				that._$outerContainer.find('> ' + CSS_CLASSES.loader).text("");
				$(that._$outerContainer).trigger(EVENT_TYPES.loading.loadingDone, that);
			}
		});

		/**
		 * Check whether the plugin is initialized with insertion options and
		 * call insertion methods if needed.
		 * 
		 * @returns inserted true if data was inserted, false if not
		 */
		this._checkInsertion = this._selfProxy(function() {
			var that = this, inserted = false;
			if (!isUndefinedOrNull(that.options.dataFormat)) {
				// console.log(this);
				if (!isUndefinedOrNull(that.options.dataLoc)) {
					inserted = true;
					that._ajaxLoadData(that.options.dataLoc, that.options.dataFormat, function(rdfData, dataFormat) {
						that._rdfStoreInsertData(rdfData, dataFormat, function() {
							$(that._$outerContainer).trigger(EVENT_TYPES.storeModified.insert, that);
						});
					});
				} else if (!isUndefinedOrNull(that.options.data)) {
					inserted = true;
					that._rdfStoreInsertData(that.options.data, that.options.dataFormat, function() {
						$(that._$outerContainer).trigger(EVENT_TYPES.storeModified.insert, that);
					});
				}
			}
			return inserted;
		});

		/**
		 * Check whether the plugin is initialized with the sort options
		 * generation option and generate the sort options if needed.
		 */
		this._checkSortGeneration = this._selfProxy(function() {
			if (this.options.generateSortOptions) {
				// Add options
				var $element = this._$element;
				var sortOptions = templates.sortOptions(this.options.isotopeOptions.getSortData);
				var $options = $element.find(".options");
				$options.prepend(sortOptions);
				$sorter = $options.find(' > .sorter');

				// Set selected on view
				$sorter.find('.' + this.options.isotopeOptions.sortBy).addClass("selected");
				$sortLinks = $options.find('a');

				// Add onClick
				$sortLinks.click(function() {
					// get href attribute, minus the '#'
					var sortName = $(this).attr('data-sort-value');
					$element.find('.sorter > > > .selected').removeClass("selected");
					$(this).addClass("selected");
					$element.find(CSS_CLASSES.toSelector("isotopeContainer")).isotope({
						sortBy : sortName
					});
					return false;
				});
			}
		});

		/**
		 * Check whether the plugin is initialized with the filter options
		 * generation option and generate the filter options if needed.
		 */
		this._checkFilterGeneration = this._selfProxy(function() {
			that = this;
			if (that.options.generateFilterOptions) {
				// Add options
				var $element = that._$element;
				var filterOptions = templates.filterOptions(that.options.filterBy);
				var $options = $element.find(".options");
				$options.append(filterOptions);

				$filter = $options.find(' > .filter');
				$filterLinks = $filter.find('a');

				// Add onClick
				$filterLinks.click(function() {
					// get href attribute, minus the '#'
					var selector = $(this).attr('data-filter-value');
					if (selector !== '*') {
						selector = ".-filter-_" + selector;
					}
					$element.find('.filter > > > .selected').removeClass('selected');
					$(this).addClass('selected');
					$element.find(CSS_CLASSES.toSelector("isotopeContainer")).isotope({
						filter : selector
					});
					return false;
				});

				$filter.append('<input id="filterField" type="text" size="25" value="Enter types here.">');
				$filterBox = $filter.find('#filterField');

				// Add onKey
				$filterBox.keyup(function(e) {

					// get href attribute, minus the '#'
					var selector = $(this).val();
					if (selector !== '') {
						if (selector !== '*') {
							selector = "div:class-prefix(-filter-_" + selector + ")";
						}
					} else {
						selector = '*';
					}

					$element.find('.filter > > > .selected').removeClass('selected');
					$(this).addClass('selected');
					$element.find(CSS_CLASSES.toSelector("isotopeContainer")).isotope({
						filter : selector
					});
					return false;
				});
			}
		});

		this._rdfStoreExecuteQuery = this._selfProxy(function(query, callback) {
			rdfStore.execute(query, function(success, results) {
				if (success) {
					callback(results);
				} else {
					$(that._$outerContainer).trigger(EVENT_TYPES.loading.loadingDone, that);
					// console.log("Error on executing: " + query);
				}
			});
		});

		/*
		 * Inserts given data in store.
		 */
		this._rdfStoreInsertData = this._selfProxy(function(data, dataFormat, callback) {
			$(that._$outerContainer).trigger(EVENT_TYPES.loading.loadingStart, that);
			// console.log("_rdfStoreInsertData");
			rdfStore.load(dataFormat, data, function(store) {
				// console.log(data);
				callback();
			});
		});

		/*
		 * Loads file at dataURL and invokes callback with loaded data
		 */
		this._ajaxLoadData = this._selfProxy(function(dataURL, dataFormat, callback) {
			var that = this;
			$(that._$outerContainer).trigger(EVENT_TYPES.loading.loadingStart, that);
			// console.log("_ajaxLoadData");
			$.ajax({
				url : dataURL,
				dataType : "text",
				success : function(rdfData) {
					// console.log(dataURL);
					callback(rdfData, dataFormat);
				}
			}).fail(function() {
				$(that._$outerContainer).trigger(EVENT_TYPES.loading.loadingDone, that);
				alert(MESSAGES.error.ajax);
			});
		});

		this._updateView = this._selfProxy(function(query) {
			var that = this;
			$(that._$outerContainer).trigger(EVENT_TYPES.loading.loadingStart, that);
			// console.log("_updateView");
			that._rdfStoreExecuteQuery(query, function(results) {
				if (results.length !== 0) {
					that._isotopeAddBatches(results);
				} else {
					$(that._$outerContainer).trigger(EVENT_TYPES.loading.loadingDone, that);
				}
			});
		});
		// <!--- instance private functions ---->

		this.init();
	}

	Plugin.prototype = {

		init : function() {

			// Init Isotope
			this._$isotopeContainer.isotope(this.options.isotopeOptions);

			// Generate SPARQL Queries
			this._initQueries();

			// <---- loading img ---->
			this._$outerContainer.prepend('<div class="' + CSS_CLASSES.loader + '">');
			this._$outerContainer.append('<div class="' + CSS_CLASSES.loader + '">');

			// Add loading start listener

			this._addEventHandler(EVENT_TYPES.loading.loadingStart, this._selfProxy(function(ev, $invoker) {
				// console.log(this);
				if ($invoker === this) {
					if (this._$outerContainer.css("height") < 120) {
						this._$outerContainer.css("height", "20px");
					}
					this._$outerContainer.find('> ' + CSS_CLASSES.toSelector("loader")).css("visibility", "visible");
				}
			}));

			// Add loading done listener
			this._addEventHandler(EVENT_TYPES.loading.loadingDone, this._selfProxy(function(ev, $invoker) {
				if ($invoker === this) {
					this._$outerContainer.find('> ' + CSS_CLASSES.toSelector("loader")).css("visibility", "hidden");
				}
			}));
			// <!--- loading img ---->

			// Add insertion listener
			this._addEventHandler(EVENT_TYPES.storeModified.insert, this._selfProxy(function(ev, $invoker) {

				// Only update the base plugin //TODO Add update support for
				// higher levels
				if (this._instanceLevel === 0) {
					this._updateView(this._queries.initQuery);
				}
			}));

			// Add a smartresize listener (smartresize to be found in
			// jQuery.isotope)
			this._addEventHandler('smartresize', this._selfProxy(function(ev, $invoker) {

				// <---- overlay modification ---->
				var $overlays = this._$element.children(CSS_CLASSES.toSelector("overlay"));
				$overlays.css('clip', getClip(CSS_CLASSES.overlay));
				var innerScrolls = $overlays.find('.innerScroll');
				innerScrolls.css("width", ($window.width() - parseInt($overlays.css("padding-left")) - parseInt($overlays.css("padding-right"))) + "px");
				innerScrolls.css("height", $window.height() * 0.95 + "px");
				// <!--- overlay modification ---->

				// <---- preview modification ---->
				var $previews = this._$element.children(CSS_CLASSES.toSelector("preview"));
				$previews.css('clip', getClip(CSS_CLASSES.preview));
				// <!--- preview modification ---->
			}), $window);

			// Init templating and RdfStore if needed
			if (globalInitDfd === undefined) {
				globalInitDfd = $.Deferred();
				$.when(this._initRdfStore(), this._initTemplating()).done(function() {
					globalInitDfd.resolve();
				});
			}

			// when done check if sort options have to be initialized and data
			// is to be inserted
			$.when(globalInitDfd.promise()).done(this._selfProxy(function() {
				if (this.options.generateSortOptions || this.options.generateFilterOptions) {
					this._$element.prepend('<section class="' + CSS_CLASSES.options + '" class="' + CSS_CLASSES.clearfix + '"></section>');
					this._checkSortGeneration();
					this._checkFilterGeneration();
				}
				if (!this._checkInsertion()) {
					if (this.options.sparqlData === undefined) {
						this._updateView(this._queries.initQuery);
					} else {
						this._isotopeAddBatches(this.options.sparqlData);
					}
				}
			}));
		},

		/**
		 * Insert given rdf-data in the store.
		 * 
		 * @arguments
		 * @param data
		 *            Rdf-data to be inserted
		 * @param dataFormat
		 *            Format of the data
		 */
		insertData : function(data, dataFormat) {
			var that = this;
			this._rdfStoreInsertData(data, dataFormat, function() {
				$(that._$outerContainer).trigger(EVENT_TYPES.storeModified.insert, that);
			});
		},

		/**
		 * Insert rdf-data of given location in the store.
		 * 
		 * @arguments
		 * @param data
		 *            URL of the data
		 * @param dataFormat
		 *            Format of the data
		 */
		insertDataURL : function(dataURL, dataFormat) {
			this._ajaxLoadData(dataURL, dataFormat, this._selfProxy(this.insertData));
		},

		/**
		 * Clean up after plugin (destroy bindings..)
		 */
		destroy : function() {
			var that = this;
			$.each(that._evHandlerHistory, function(eventType, binding) {
				$.each(binding, function(i, val) {
					val.object.off(eventType, val.handler);
				});
			});
			that._evHandlerHistory = undefined;
			pluginInstanceCount--;
			that._$element[pluginName] = null;
		}

	};

	// Lightweight plugin frame.
	$.fn[pluginName] = function(options) {
		return this.each(function() {
			if (!$.data(this, "plugin_" + pluginName)) {
				$.data(this, "plugin_" + pluginName, new Plugin(this, options));
			}
		});
	};

})(jQuery, window, document);