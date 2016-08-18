'use strict';

import gulp from 'gulp';
import babel from 'gulp-babel';

gulp.task('babel', () => {
  return gulp.src('src/app.js')
    .pipe(babel())
    .pipe(gulp.dest('./'));
});

gulp.task('default', ['babel'], () => {
  // run `babel` task on file changes
  gulp.watch([
    './*',
    './src/*',
  ], ['babel']);
});
